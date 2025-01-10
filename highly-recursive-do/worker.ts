import { DurableObject } from "cloudflare:workers";

// Configuration constants
const BRANCHES_PER_LAYER = 3;
const INITIAL_BACKOFF_MS = 100;
const MAX_BACKOFF_MS = 5000;
const MAX_RETRIES = 10;
const JITTER_MAX_MS = 50;

export interface Env {
  RECURSIVE_FETCHER: DurableObjectNamespace;
  SECRET: string;
}

// Worker code remains the same as it doesn't need backoff logic
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.searchParams.get("secret") !== env.SECRET) {
      return new Response("Please provide secret");
    }
    const amount = parseInt(url.searchParams.get("amount") || "1");
    const t = Date.now();
    if (isNaN(amount) || amount < 1) {
      return new Response("Invalid amount parameter", { status: 400 });
    }

    const urls = Array.from(
      { length: amount },
      () =>
        `https://hacker-news.firebaseio.com/v0/item/${Math.ceil(
          Math.random() * 42000000,
        )}.json`,
    );

    const id = env.RECURSIVE_FETCHER.newUniqueId();
    const recursiveFetcher = env.RECURSIVE_FETCHER.get(id);

    try {
      const response = await recursiveFetcher.fetch("http://internal/", {
        method: "POST",
        body: JSON.stringify(urls),
      });

      if (!response.ok) {
        throw new Error(`DO returned status ${response.status}`);
      }

      const result = await response.json();
      const duration = Date.now() - t;

      return new Response(JSON.stringify({ result, duration }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error in worker:", error);
      return new Response(JSON.stringify({ 500: amount }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};

// Enhanced DO implementation
export class RecursiveFetcherDO extends DurableObject {
  private activeRequests: number = 0;
  private lastRequestTime: number = 0;

  constructor(readonly state: DurableObjectState, readonly env: Env) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const urls: string[] = await request.json();

      if (urls.length === 0) {
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Track request load
      this.activeRequests++;
      const currentTime = Date.now();
      this.lastRequestTime = currentTime;

      try {
        if (urls.length === 1) {
          return await this.handleSingleUrl(urls[0]);
        }
        return await this.handleMultipleUrls(urls);
      } finally {
        this.activeRequests--;
      }
    } catch (error) {
      console.error("Error in DO:", error);
      return new Response(JSON.stringify({ 500: 1 }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async handleSingleUrl(url: string): Promise<Response> {
    let retries = 0;
    let delay = INITIAL_BACKOFF_MS;

    while (retries < MAX_RETRIES) {
      try {
        const response = await fetch(url);
        const text = await response.text();

        if (response.status === 429 || response.status === 503) {
          throw new Error(`Rate limited: ${response.status}`);
        }

        const resultText =
          response.status === 200 ? "200" : `${response.status}:${text}`;
        return new Response(JSON.stringify({ [resultText]: 1 }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        retries++;
        if (retries === MAX_RETRIES) {
          return new Response(JSON.stringify({ "Error Fetching URL": 1 }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Calculate backoff with jitter
        const jitter = Math.random() * JITTER_MAX_MS;
        delay = Math.min(delay * 2, MAX_BACKOFF_MS) + jitter;

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return new Response(JSON.stringify({ "Max Retries Exceeded": 1 }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleMultipleUrls(urls: string[]): Promise<Response> {
    const chunkSize = Math.ceil(
      urls.length / Math.min(BRANCHES_PER_LAYER, urls.length),
    );
    const chunks: string[][] = [];

    for (let i = 0; i < urls.length; i += chunkSize) {
      chunks.push(urls.slice(i, i + chunkSize));
    }

    const processSingleChunk = async (chunk: string[]) => {
      let retries = 0;
      let delay = INITIAL_BACKOFF_MS;

      while (retries < MAX_RETRIES) {
        try {
          const id = this.env.RECURSIVE_FETCHER.newUniqueId();
          const fetcher = this.env.RECURSIVE_FETCHER.get(id);

          const response = await fetcher.fetch("http://internal/", {
            method: "POST",
            body: JSON.stringify(chunk),
          });

          if (response.status === 429 || response.status === 503) {
            throw new Error(`Rate limited: ${response.status}`);
          }

          if (!response.ok) {
            throw new Error(`Other status: ${response.status}`);
          }

          return (await response.json()) as Record<string, number>;
        } catch (e: any) {
          retries++;
          if (retries === MAX_RETRIES) {
            const message = e.message;
            return {
              [`500 - Failed to fetch self - ${message}`]: chunk.length,
            };
          }

          // Calculate backoff with jitter
          const jitter = Math.random() * JITTER_MAX_MS;
          delay = Math.min(delay * 2, MAX_BACKOFF_MS) + jitter;

          // Additional backoff if we detect high load
          if (this.activeRequests > BRANCHES_PER_LAYER * 2) {
            delay *= 1.5;
          }

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      return { "Max Retries Exceeded": chunk.length };
    };

    try {
      const results = await Promise.all(chunks.map(processSingleChunk));

      // Aggregate results
      const finalCounts: Record<string, number> = {};
      for (const result of results) {
        for (const [status, count] of Object.entries(result)) {
          finalCounts[status] = (finalCounts[status] || 0) + count;
        }
      }

      return new Response(JSON.stringify(finalCounts), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error processing chunks:", error);
      return new Response(
        JSON.stringify({ "Catch in handling multiple URLs": urls.length }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }
}
