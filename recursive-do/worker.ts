import { DurableObject } from "cloudflare:workers";

export interface Env {
  RATE_LIMITER: DurableObjectNamespace;
  CREATOR: DurableObjectNamespace;
  SECRET: string;
}

export interface URLRequest {
  url: string;
  id: string;
}

// Main worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const secret = url.searchParams.get("secret");
      const amount = Number(url.searchParams.get("amount") || 100);
      const isSecret = secret === env.SECRET;
      const maxAmount = isSecret ? 1000000 : 9000;

      if (isNaN(amount) || amount < 0 || amount > maxAmount) {
        return new Response(
          isSecret
            ? "Max 1mil bro, take it easy"
            : "If you don't know the secret, the amount cannot be over " +
              maxAmount,
          { status: 400 },
        );
      }

      const t0 = Date.now();

      // Example URLs creation (you would replace this with your actual URLs)
      const urls = Array.from({ length: amount }, (_, i) => ({
        url: `https://test.github-backup.com/?random=${Math.random()}`,
        id: (i + 1).toString(),
      }));

      // Create a Creator DO instance
      const creatorId = env.CREATOR.newUniqueId();
      const creator = env.CREATOR.get(creatorId);

      // Send the URLs to the Creator DO
      const response = await creator.fetch(
        new Request("https://dummy-url/process", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ urls }),
        }),
      );

      const results: { results: any[] } = await response.json();
      const t1 = Date.now();

      return new Response(
        JSON.stringify(
          {
            duration: t1 - t0,
            resultCount: results.results.length,
            results: results.results,
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
    } catch (e: any) {
      return new Response("catched error: " + e.message, { status: 500 });
    }
  },
};

// Creator DO that manages RequestSchedulerDOs
export class CreatorDO extends DurableObject {
  constructor(state: DurableObjectState, private env: Env) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const { urls } = (await request.json()) as { urls: URLRequest[] };

    // If URLs length is <= 500, create RequestSchedulerDOs directly
    if (urls.length <= 500) {
      return await this.processUrlBatch(urls);
    }

    // Split URLs into batches of 500 and create multiple CreatorDOs
    const batches = this.splitIntoBatches(urls, 500);
    const results = await Promise.all(
      batches.map(async (batchUrls) => {
        const creatorId = this.env.CREATOR.newUniqueId();
        const creator = this.env.CREATOR.get(creatorId);
        const response = await creator.fetch(
          new Request("https://dummy-url/process", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ urls: batchUrls }),
          }),
        );
        return response.json();
      }),
    );

    // Combine results from all batches
    const combinedResults = this.combineResults(results);
    return new Response(JSON.stringify(combinedResults), {
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  private splitIntoBatches<T>(array: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      batches.push(array.slice(i, i + size));
    }
    return batches;
  }

  private async processUrlBatch(urls: URLRequest[]): Promise<Response> {
    const doIds: { id: DurableObjectId; url: string }[] = [];

    // Create RequestSchedulerDOs
    await Promise.all(
      urls.map(async ({ url }) => {
        const doId = this.env.RATE_LIMITER.newUniqueId();
        doIds.push({ id: doId, url });
      }),
    );

    // First pass: Initialize fetches
    await Promise.all(
      doIds.map(async ({ id, url }) => {
        const instance = this.env.RATE_LIMITER.get(id);
        await instance.fetch(
          new Request(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          }),
        );
      }),
    );

    // Second pass: Get results
    const results = await Promise.all(
      doIds.map(async ({ id, url }) => {
        const instance = this.env.RATE_LIMITER.get(id);
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
      }),
    );

    return new Response(JSON.stringify({ results }), {
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  private combineResults(batchResults: any[]): any {
    return {
      results: batchResults.flatMap((batch) => batch.results),
    };
  }
}

// RequestSchedulerDO implementation (mostly unchanged)
export class RequestSchedulerDO extends DurableObject {
  private fetchPromises: Map<string, Promise<Response>>;
  private results: Map<string, number>;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.fetchPromises = new Map();
    this.results = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = request.url;

      if (request.method === "POST") {
        if (!this.fetchPromises.has(url)) {
          const time = Date.now();
          const fetchPromise = fetch(url)
            .then(async (response) => {
              const text = await response.text();
              const duration = Date.now() - time;
              this.results.set(url, duration);
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
        const promise = this.fetchPromises.get(url);
        if (!promise) {
          return new Response(
            JSON.stringify({ error: "No fetch in progress for this URL" }),
            { status: 404 },
          );
        }

        await promise;
        const result = this.results.get(url);

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
