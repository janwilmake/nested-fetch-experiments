const results = (
  await Promise.all(
    new Array(10).fill(null).map((_) => {
      return fetch("https://call-directly.deno.dev/").then((res) => res.json());
    }),
  )
)
  .map((x) => x.results)
  .flat();

console.log({ results });
