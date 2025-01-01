export default {
  fetch: async (request: Request) => {
    const time = Date.now();
    try {
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

      if (urls.length <= 100) {
        //base case
        const results = await Promise.all(
          urls.map(async (url) => {
            // fetch something
            const result = await fetch(url).then((res) => res.text());

            return result;
          }),
        );
        // can be done concurrent
        const ms = Date.now() - time;

        return new Response(JSON.stringify({ results, ms }));
      }

      const splitCount =
        urls.length < 10000 ? 100 : Math.ceil(urls.length / 100);
      const amount = urls.length < 10000 ? Math.ceil(urls.length / 100) : 100;
      console.log({ splitCount, amount });
      const results = (
        await Promise.all(
          new Array(amount).fill(null).map(async (_, index) => {
            // fetch self
            const part = urls.slice(
              splitCount * index,
              splitCount * index + splitCount,
            );

            if (part.length === 0) {
              return [];
            }

            const results = await fetch(`https://call-directly.deno.dev/`, {
              method: "POST",
              body: JSON.stringify(part),
            }).then((res) => res.text());

            try {
              return JSON.parse(results)?.results;
            } catch (e) {
              return results;
            }
          }),
        )
      ).flat();

      const ms = Date.now() - time;
      // can be done concurrent
      return new Response(JSON.stringify({ results, ms }));
    } catch (e) {
      return new Response(JSON.stringify(["Went wrong:" + e.message]), {
        status: 500,
      });
    }
  },
};
