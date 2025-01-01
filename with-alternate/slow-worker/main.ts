export default {
  fetch: async (request: Request) => {
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 5000));
    return new Response(String(Math.random()));
  },
};
