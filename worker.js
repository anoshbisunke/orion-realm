export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Backend health check
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "online",
        project: "Orion Realm",
        backend: "operational"
      });
    }

    // Serve the existing website
    return env.ASSETS.fetch(request);
  }
};
