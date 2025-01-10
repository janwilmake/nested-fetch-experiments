Prompt:

```
I want to create a Cloudflare Worker with a RecursiveFetcherDO:

The worker fetch handler takes a GET request with an ?amount param and generates that amount of URLs that lead to https://test.github-backup.com?random=${Math.random()}

It sends that to the RecursiveFetcherDO which should ultimately return a mapped object {[status:number]:number} that counts the status of requests (or 500 if the DO creation failed)

The DO will do 2 things:

1. if it takes in more than 1 URL, it will chunk the url array in up to 5 chunks (this number is a configurable constant we want to experiment with) and creates a new instance of RecursiveFetcherDO for each chunk, finally aggregating the mapped status object.
2. if it takes just 1 URL, will fetch that URL and return { [status:number]: 1 } or { 500: 1 } if it crashes

Please implement this in cloudflare, typescript.
```

First I did a Naive implementation like above, without exponential backoff.

Results with `BRANCHES_PER_LAYER` of 2, meaning it is highly recursive:

- https://highly-recursive-do.YOURWORKERLOCATION.workers.dev/?amount=16384 returns `{"result":{"200":16384},"duration":2789}` which is a DO depth of 14.
- https://highly-recursive-do.YOURWORKERLOCATION.workers.dev/?amount=16384 returns `{"result":{"500 - Failed to fetch self - Subrequest depth limit exceeded. This request recursed through Workers too many times. This can happen e.g. if you have a Worker or Durable Object that calls other Workers or objects recursively.":32768},"duration":3690}` which is a DO depth of 15. This means we cannot exceed a depth of 15 as of now on the pro plan.

Results with `BRANCHES_PER_LAYER` of 3 (We won't hit a depth of 15):

- 50000 requests: `{"result":{"200":49270,"500 - Failed to fetch self - Your account is generating too much load on Durable Objects. Please back off and try again later.":474,"503:error code: 1200":253,"500 - Failed to fetch self":3},"duration":17462}`
- 3^10 requests (59049): `{"result":{"200":58138,"500 - Failed to fetch self - Your account is generating too much load on Durable Objects. Please back off and try again later.":911},"duration":10784}`.
- 250000 requests: `{"result":{"200":115023,"503:error code: 1200":3915,"500 - Failed to fetch self - Your account is generating too much load on Durable Objects. Please back off and try again later.":131061,"500 - Failed to fetch self":1},"duration":16153}`

After this, I implemented exponential backoff as can be seen in the current implementation. The results show it's very stable for 100k requests:

```
{"result":{"200":100000},"duration":13895}
{"result":{"200":100000},"duration":11600}
{"result":{"200":100000},"duration":12396}
{"result":{"200":100000},"duration":12901}
{"result":{"200":100000},"duration":56135}
{"result":{"200":100000},"duration":13297}
{"result":{"200":100000},"duration":14078}
{"result":{"200":100000},"duration":37302}
{"result":{"200":100000},"duration":12484}
{"result":{"200":100000},"duration":65307}
```

100k fetch responses in 11.6 seconds, that's an impressive feat!

With 1M requests it takes for ever to answer, so there must be better things we can do. If we could handle concurrency better, it may work.
