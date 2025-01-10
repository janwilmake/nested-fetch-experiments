is it possible to alter the implementation such that we can configure the amount of URLs fetched in the base case (if(this.urls.length < FETCHES_PER_DO))?
and can we somehow set the max requests per time unit?
a naive Ratleimiter in the DO won't work because there is a separate ratelimit in each DO and they are in different places. a central ratleimiter DO won't work either because it would be under a too high load as I want to have more than 10k RPS. but maybe we can ratelimit just on Requests per window, not on concurrency, calculate the amount of requests per 100ms, then iterate on sending a chunk each 100ms to have proper concurrency.
that could be what we do in the worker fetch handler.

Result: With a controlled max concurrency, I finally achieved a million requests and it took a very reliable 208 seconds, just 8 seconds after it released the last batch.

- `amount=100000, ratelimit=5000`: {"results":{"200":100000},"duration":25611}
- `amount=1000000, rateLimit=5000`: {"results":{"200":1000000},"duration":208854}
