import { DurableObject } from "cloudflare:workers";

// Configuration constants
const BRANCHES_PER_LAYER = 10;
const INITIAL_BACKOFF_MS = 100;
const MAX_BACKOFF_MS = 5000;
const MAX_RETRIES = 10;
const JITTER_MAX_MS = 50;
const WINDOW_SIZE_MS = 1000; // Time window for rate limiting
const FETCHES_PER_DO = 60; // Base case threshold for direct fetching

export interface Env {
  RECURSIVE_FETCHER: DurableObjectNamespace;
  SECRET: string;
}

// Add configuration interface
export interface FetcherConfig {
  urls: string[];
  fetchesPerDO?: number; // Optional base case threshold
}

// Enhanced worker implementation with rate limiting
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.searchParams.get("secret") !== env.SECRET) {
      return new Response("Please provide secret");
    }

    const amount = parseInt(url.searchParams.get("amount") || "1");
    const requestsPerWindow = parseInt(
      url.searchParams.get("rateLimit") || "0",
    );
    const fetchesPerDO = parseInt(
      url.searchParams.get("batchSize") || String(FETCHES_PER_DO),
    );

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

    // Split URLs into time-windowed chunks if rate limiting is enabled
    let urlChunks: string[][] = [urls];
    if (requestsPerWindow > 0) {
      const chunkSize = requestsPerWindow;
      urlChunks = [];
      for (let i = 0; i < urls.length; i += chunkSize) {
        urlChunks.push(urls.slice(i, i + chunkSize));
      }
    }

    const results: Record<string, number> = {};

    const promises: Promise<void>[] = [];
    // Process chunks with time windows
    for (let i = 0; i < urlChunks.length; i++) {
      const promise = (async () => {
        const chunk = urlChunks[i];
        try {
          const id = env.RECURSIVE_FETCHER.newUniqueId();
          const recursiveFetcher = env.RECURSIVE_FETCHER.get(id);
          console.log(
            `batch ${i}: ${chunk.length} urls (${new Date(
              Date.now(),
            ).toISOString()})`,
          );
          const config: FetcherConfig = {
            urls: chunk,
            fetchesPerDO,
          };

          const response = await recursiveFetcher.fetch("http://internal/", {
            method: "POST",
            body: JSON.stringify(config),
          });

          if (!response.ok) {
            throw new Error(`DO returned status ${response.status}`);
          }

          const chunkResults = (await response.json()) as Record<
            string,
            number
          >;

          for (const [status, count] of Object.entries(chunkResults)) {
            results[status] = (results[status] || 0) + count;
          }
        } catch (error) {
          console.error("Error in worker:", error);
          results["500"] = (results["500"] || 0) + chunk.length;
        }
      })();
      promises.push(promise);

      // Aggregate results

      // Wait for next window if rate limiting is enabled
      if (requestsPerWindow > 0 && i < urlChunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, WINDOW_SIZE_MS));
      }
    }

    await Promise.all(promises);

    const duration = Date.now() - t;
    return new Response(JSON.stringify({ results, duration }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};

// Enhanced DO implementation
export class RecursiveFetcherDO extends DurableObject {
  private activeRequests: number = 0;

  constructor(readonly state: DurableObjectState, readonly env: Env) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const config: FetcherConfig = await request.json();
      const { urls, fetchesPerDO = FETCHES_PER_DO } = config;

      if (urls.length === 0) {
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
        });
      }

      this.activeRequests++;

      try {
        if (urls.length <= fetchesPerDO) {
          return await this.handleUrls(urls);
        }
        return await this.handleMultipleUrls(urls, fetchesPerDO);
      } finally {
        this.activeRequests--;
      }
    } catch (error) {
      console.error("Error in DO:", error);
      return new Response(JSON.stringify({ "500": 1 }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async handleUrls(urls: string[]): Promise<Response> {
    const results: Record<string, number> = {};

    for (const url of urls) {
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
          results[resultText] = (results[resultText] || 0) + 1;
          break;
        } catch (error) {
          retries++;
          if (retries === MAX_RETRIES) {
            results["Error Fetching URL"] =
              (results["Error Fetching URL"] || 0) + 1;
            break;
          }

          const jitter = Math.random() * JITTER_MAX_MS;
          delay = Math.min(delay * 2, MAX_BACKOFF_MS) + jitter;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleMultipleUrls(
    urls: string[],
    fetchesPerDO: number,
  ): Promise<Response> {
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

          const config: FetcherConfig = {
            urls: chunk,
            fetchesPerDO,
          };

          const response = await fetcher.fetch("http://internal/", {
            method: "POST",
            body: JSON.stringify(config),
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
            return {
              [`500 - Failed to fetch self - ${e.message}`]: chunk.length,
            };
          }

          const jitter = Math.random() * JITTER_MAX_MS;
          delay = Math.min(delay * 2, MAX_BACKOFF_MS) + jitter;

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
