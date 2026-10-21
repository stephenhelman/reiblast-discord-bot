import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { healthRoute } from "./health.js";
import { revokeRoute, type RevokeRouteDeps } from "./revoke.js";

export interface HttpDeps {
  isDiscordReady: () => boolean;
  revoke: Omit<RevokeRouteDeps, "isDiscordReady">;
}

export function buildApp(deps: HttpDeps): Hono {
  const app = new Hono();
  app.route("/", healthRoute(deps.isDiscordReady));
  app.route("/", revokeRoute({ ...deps.revoke, isDiscordReady: deps.isDiscordReady }));
  return app;
}

export function startHttpServer(app: Hono, port: number): Promise<ServerType> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, () => resolve(server));
  });
}

export function closeHttpServer(server: ServerType): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    // Drop idle keep-alive connections so close() isn't held open by them.
    if ("closeIdleConnections" in server) server.closeIdleConnections();
  });
}
