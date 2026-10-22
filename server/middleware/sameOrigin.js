import { env } from "../config/env.js";

export function sameOrigin(request, response, next) {
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) return next();
  if (!request.is("application/json")) return response.status(415).json({ error: "JSON required" });

  const source = request.get("origin") || request.get("referer");
  if (!source) return response.status(403).json({ error: "Origin required" });

  try {
    const sourceUrl = new URL(source);
    const hostHeader = request.get("x-forwarded-host") || request.get("host");

    // Exact host match is always valid
    if (sourceUrl.host === hostHeader || sourceUrl.host === request.get("host")) return next();

    // In development, allow switching between localhost and 127.0.0.1 on the configured port
    if (env.nodeEnv !== "production") {
      const allowedDevHosts = new Set([
        `localhost:${env.port}`,
        `127.0.0.1:${env.port}`,
        `[::1]:${env.port}`,
        "localhost",
        "127.0.0.1",
      ]);

      if (allowedDevHosts.has(sourceUrl.host) && (allowedDevHosts.has(hostHeader) || !hostHeader)) {
        return next();
      }
    }

    return response.status(403).json({ error: "Origin not allowed" });
  } catch {
    return response.status(403).json({ error: "Origin not allowed" });
  }
}
