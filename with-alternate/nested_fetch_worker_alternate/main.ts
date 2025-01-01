export default {
  fetch: async (request: Request) => {
    const url = new URL(request.url);
    const count = url.searchParams.get("count");
    const urls =
      request.method === "POST"
        ? await request.json<string[]>()
        : new Array(Number(count || 100)).fill(null).map(
            // random to prevent cache
            (_) => `https://test.github-backup.com/?random=${Math.random()}`,
          );

    console.log("count", urls.length);

    if (urls.length <= 6) {
      //base case
      const results = await Promise.all(
        urls.map(async (url) => {
          // fetch something
          const result = await fetch(url).then((res) => res.text());

          return result;
        }),
      );
      // can be done concurrent
      return new Response(JSON.stringify(results));
    }

    const splitCount = Math.ceil(urls.length / 6);

    const results = (
      await Promise.all(
        new Array(6).fill(null).map(async (_, index) => {
          // fetch self
          const part = urls.slice(
            splitCount * index,
            splitCount * index + splitCount,
          );

          if (part.length === 0) {
            return [];
          }

          const results = fetch(
            `https://nested_fetch_worker.githuq.workers.dev`,
            {
              method: "POST",
              body: JSON.stringify(part),
            },
          ).then((res) => res.json<any[]>());

          return results;
        }),
      )
    ).flat();

    // can be done concurrent
    return new Response(JSON.stringify(results));
  },
};
