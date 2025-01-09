// worker.ts

import { DurableObject } from "cloudflare:workers";

export interface Env {
  RATE_LIMITER: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const t0 = Date.now();
    const urls = Array.from({ length: 499 }, (_, i) => ({
      // this url takes 5s
      url: `https://test.github-backup.com/?random=${Math.random()}`,
      id: (i + 1).toString(),
    }));

    console.log("urls:", urls.length);

    const doIds: { id: DurableObjectId; url: string }[] = [];

    // First pass: Create the DOs
    const initPromises = urls.map(async ({ url, id }) => {
      console.log({ id });
      const doId = env.RATE_LIMITER.newUniqueId();
      doIds.push({ id: doId, url });
    });

    await Promise.all(initPromises);
    const t1 = Date.now();

    const first = await Promise.all(
      doIds.map(async ({ id, url }) => {
        const instance = env.RATE_LIMITER.get(id);
        const response = await instance.fetch(
          new Request(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          }),
        );

        return await response.json();
      }),
    );
    const t2 = Date.now();

    // Second pass: Check results from all DOs
    const resultPromises = doIds.map(async ({ id, url }) => {
      const instance = env.RATE_LIMITER.get(id);
      const response = await instance.fetch(
        new Request(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );

      const result = await response.json();

      return {
        doName: id.name,
        url,
        result,
      };
    });

    const results = await Promise.all(resultPromises);
    const t3 = Date.now();

    return new Response(
      JSON.stringify(
        {
          firstPass: t1 - t0,
          secondPass: t2 - t1,
          thirdPass: t3 - t2,
          full: t3 - t0,
          results,
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  },
};

// Durable Object implementation
export class RequestSchedulerDO extends DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private fetchPromises: Map<string, Promise<Response>>;
  private results: Map<string, number>; // New map to store results in memory

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.fetchPromises = new Map();
    this.results = new Map(); // Initialize results map
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = request.url;

      if (request.method === "POST") {
        // Initialize new fetch
        if (!this.fetchPromises.has(url)) {
          const time = Date.now();
          const fetchPromise = fetch(url)
            .then(async (response) => {
              const text = await response.text();
              const duration = Date.now() - time;
              this.results.set(url, duration); // Store in memory instead of DO storage
              return response;
            })
            .catch((error) => {
              console.error(`Fetch error for ${url}:`, error);
              return new Response(`Error: ${error.message}`, { status: 500 });
            });

          this.fetchPromises.set(url, fetchPromise);
        }

        return new Response(
          JSON.stringify({
            status: "processing",
            url: request.url,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      } else if (request.method === "GET") {
        // Check status and return result
        const promise = this.fetchPromises.get(url);
        if (!promise) {
          return new Response(
            JSON.stringify({ error: "No fetch in progress for this URL" }),
            { status: 404 },
          );
        }

        await promise; // Wait for the fetch to complete
        const result = this.results.get(url); // Get result from memory

        return new Response(
          JSON.stringify({
            status: "completed",
            result,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return new Response("Invalid method", { status: 405 });
    } catch (error: any) {
      return new Response(`Error: ${error.message}`, {
        status: 500,
      });
    }
  }
}
