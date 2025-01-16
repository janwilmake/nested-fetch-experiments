I did some experiments to see if I could bypass the queue and simply directly do 1000s of fetch requests by nesting them in workers.

Experiments carried out:

1. tried a nested cloudflare worker that calls itself recursively to perform parts of the fetch. this showed that the max concurrent requests will stay for both the main requests and all subrequests together, so we can't surpass it this way.
2. tried to do that same thing but using alternate workers that call each other. it seems that this causes it to crash, so isn't stable either.
3. tried deno deploy with the same code (slightly altered). this shows there is a limit of 100 concurrent fetch requests. when trying to fetch itself, we get LOOP_DETECTED. when running 10 fetches from my local machine to deno they all seem to land in the same worker because the concurrency doesn't increase.

Conclusion for now:

- queues remain the best way to distribute workload
- in deno, a queue likely doesn't have the same concurrency (its purpose is to deliver high workloads) and may be faster than in cloudflare. i could test this at another time https://docs.deno.com/deploy/kv/manual/queue_overview/#queue-behavior

Also, a conclusion is that it's actually quite annoying that it's not possible to easily do recursive requests in workers. I believe it should be simpler and you should not immediately get an error for "Loop detected" or stuff like that, because sometimes it's just important and useful to be able to do such things.

And create stronger patterns that can make it possible to do more with workers. Now we are bound to and required to use things like the queue, and that's not needed, because if you can just recursively call workers, you can do these patterns in other ways that make them potentially faster, more performant, more cheap. Yeah, and I think I think queues are not perfect in every scenario. But anyway, that's just my opinion. And I think there's definitely a lot that can be improved for workers, but for now we need to do it with the queues system that we were given.

# update 9 january, 2025

Created 4 more experiments; see the README in the respective folders for more details.

- [`with-do`](with-do) uses a cloudflare [Durable Object](https://developers.cloudflare.com/durable-objects/) to perform fetch requests. Limited to 500
- [`with-do6`](with-do6) uses a cloudflare [Durable Object](https://developers.cloudflare.com/durable-objects/) to perform 6 fetch requests each. Limited to 3000
- [`recursive-do`](recursive-do) uses a cloudflare [Durable Object](https://developers.cloudflare.com/durable-objects/) to create more 'creator DOs', recursively, until it can create up to 500 requester DOs.
- [`highly-recursive-do`](highly-recursive-do) adds exponential backoff, better error handling, and BRANCHES_PER_LAYER to control how deep the DO's will nest, resulting in successfully do 100.000 HTTP requests to an exernal API in at least 11.6 seconds.

# update january 16, 2025

I've created [dodfetch](https://github.com/janwilmake/dodfetch) based off of this work.

However, i've become aware that this function shall be handled with care due to the cost it can bring about. The thing is, [DO's charge a large amount for wallclock time](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Let's say, an api call takes on average 1 sec.

128mb x1 sec = 0.128 GB-s

Durable objects cost $12.50/million GB-s + $0.15/million requests.

Therefore, **the cost of dodfetch for one million requests would be around $1.75 times the average request-time in seconds**. Because of this, it's only useful to use dodfetch for queries that happen fast. Requests to LLMs, for example, are better off using a different approach, such as a queue, because it becomes too expensive.

If you run 1 million fetch requests to an LLM API that take 30 seconds each, this will cost you **$52.50**.

Unfortunately, I've found out the hard way...

> [!CAUTION]
> Use this function with care!
