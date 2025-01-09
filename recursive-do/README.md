This implementation is the same as the [RequestSchedulerDO](../with-do) but also there's a CreatorDO that creates all the DO's and wait for the responses, the worker just fetches the CreatorDO.

If there's more than 500 URLs going into the CreatorDO, it will create a CreatorDO instance for each set of 500 URLs (recursive case), and wait for the results to combine them. If there's 500 URLs or less it will just create a RequestSchedulerDO instance for each request.

Tested and I did 100k requests just now!

Using a recursive DO.

The result was a 16MB response with:

- "duration": 71305,
- "resultCount": 100000

The first time it hit an exception, the second time it worked. Unclear why.
