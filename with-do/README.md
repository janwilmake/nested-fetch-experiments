This implementation fetches an url 499 times.

The endpoint behind the URL takes 5 seconds to load.

This number is intentionally 499, because the worker crashes for 500 requests or more. I assume because the limit of 1000 sub-requests (and making the DO also counts as a request, i suppose)

This is what it returns:

```json
{
  "firstPass": 0,
  "secondPass": 2213,
  "thirdPass": 5078,
  "full": 7291,
  "results": [
    {
      "url": "https://test.github-backup.com/?random=0.10693229688140571",
      "result": {
        "status": "completed",
        "result": 5058
      }
    }
    //.....
  ]
}
```

This means creating 499 DO's and sending initial requests to them is done in 2.22 seconds. After that, waiting for all of them is just 5.08s, proving all requests happen in parallel.

Test yourself at https://fetch-many-do.githuq.workers.dev
