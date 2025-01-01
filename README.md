I did some experiments to see if I could bypass the queue and simply directly do 1000s of fetch requests by nesting them in workers.

Experiments carried out:

1. tried a nested cloudflare worker that calls itself recursively to perform parts of the fetch. this showed that the max concurrent requests will stay for both the main requests and all subrequests together, so we can't surpass it this way.
2. tried to do that same thing but using alternate workers that call each other. it seems that this causes it to crash, so isn't stable either.
3. tried deno deploy with the same code (slightly altered). this shows there is a limit of 100 concurrent fetch requests. when trying to fetch itself, we get LOOP_DETECTED. when running 10 fetches from my local machine to deno they all seem to land in the same worker because the concurrency doesn't increase.

Conclusion for now:

- queues remain the best way to distribute workload
- in deno, a queue likely doesn't have the same concurrency (its purpose is to deliver high workloads) and may be faster than in cloudflare. i could test this at another time https://docs.deno.com/deploy/kv/manual/queue_overview/#queue-behavior
