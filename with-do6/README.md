This implementation is the same as [with-do](../with-do) but instead it does 6 requests in each worker. Interestingly enough, it works, surpassing the 1000 subrequest limit.

This means the limit seems to be unrelated to what we do inside of the DO. The limit is rather the request to the DO (twice) which makes 2x500=1000.

In the DO, we can do as many requests as we want.

Another interesting observation is that this takes 16.5s instead of 7. This shows how fast CF scales on the pro plan. Apparently, more requests outwards also takes a longer time, and it's not just the 6 concurrent requests that matters, but more likely the server load.

```json
{
  "firstPass": 0,
  "secondPass": 2262,
  "thirdPass": 14235,
  "full": 16497,
  "results": [
    {
      "urls": [
        "https://test.github-backup.com/?random=0.9895069871610036&request=0",
        "https://test.github-backup.com/?random=0.81532704150307&request=1",
        "https://test.github-backup.com/?random=0.6285762251415596&request=2",
        "https://test.github-backup.com/?random=0.8455794640554448&request=3",
        "https://test.github-backup.com/?random=0.5812898782659197&request=4",
        "https://test.github-backup.com/?random=0.7232639741259355&request=5"
      ],
      "result": {
        "status": "completed",
        "results": {
          "https://test.github-backup.com/?random=0.9895069871610036&request=0": 5038,
          "https://test.github-backup.com/?random=0.81532704150307&request=1": 5037,
          "https://test.github-backup.com/?random=0.6285762251415596&request=2": 5042,
          "https://test.github-backup.com/?random=0.8455794640554448&request=3": 5038,
          "https://test.github-backup.com/?random=0.5812898782659197&request=4": 5040,
          "https://test.github-backup.com/?random=0.7232639741259355&request=5": 5051
        }
      }
    }
  ,
  //...498 more

}
```
