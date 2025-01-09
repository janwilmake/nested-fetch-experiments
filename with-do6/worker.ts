// worker.ts

import { DurableObject } from "cloudflare:workers";

export interface Env {
  PDO: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const t0 = Date.now();
    const urls = Array.from({ length: 499 }, (_, i) => ({
      urls: Array.from(
        { length: 6 },
        (_, j) =>
          `https://test.github-backup.com/?random=${Math.random()}&request=${j}`,
      ),
      id: (i + 1).toString(),
    }));

    console.log("urls:", urls.length);

    const doIds: { id: DurableObjectId; urls: string[] }[] = [];

    // First pass: Create the DOs
    const initPromises = urls.map(async ({ urls, id }) => {
      console.log({ id });
      const doId = env.PDO.newUniqueId();
      doIds.push({ id: doId, urls });
    });

    await Promise.all(initPromises);
    const t1 = Date.now();

    // Second pass: Initialize fetches in all DOs
    const first = await Promise.all(
      doIds.map(async ({ id, urls }) => {
        const instance = env.PDO.get(id);
        const response = await instance.fetch(
          new Request(urls[0], {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ urls }),
          }),
        );

        return await response.json();
      }),
    );
    const t2 = Date.now();

    // Third pass: Check results from all DOs
    const resultPromises = doIds.map(async ({ id, urls }) => {
      const instance = env.PDO.get(id);
      const response = await instance.fetch(
        new Request(urls[0], {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );

      const result = await response.json();

      return {
        doName: id.name,
        urls,
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
export class PDO extends DurableObject {
  private state: DurableObjectState;
  private fetchPromises: Map<string, Promise<Response>>;
  private results: Map<string, number>;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.fetchPromises = new Map();
    this.results = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = request.url;

      if (request.method === "POST") {
        // Initialize new fetches for all URLs
        const { urls }: { urls: string[] } = await request.json();

        for (const fetchUrl of urls) {
          if (!this.fetchPromises.has(fetchUrl)) {
            const time = Date.now();
            const fetchPromise = fetch(fetchUrl)
              .then(async (response) => {
                const text = await response.text();
                const duration = Date.now() - time;
                this.results.set(fetchUrl, duration);
                return response;
              })
              .catch((error) => {
                console.error(`Fetch error for ${fetchUrl}:`, error);
                return new Response(`Error: ${error.message}`, { status: 500 });
              });

            this.fetchPromises.set(fetchUrl, fetchPromise);
          }
        }

        return new Response(
          JSON.stringify({
            status: "processing",
            urls,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      } else if (request.method === "GET") {
        // Check status and return results for all URLs
        const promises = Array.from(this.fetchPromises.values());
        const urls = Array.from(this.fetchPromises.keys());

        // Wait for all promises to complete concurrently
        await Promise.all(promises);

        const allResults = Object.fromEntries(
          urls.map((url) => [url, this.results.get(url)]),
        );

        return new Response(
          JSON.stringify({
            status: "completed",
            results: allResults,
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
