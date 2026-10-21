import { Hono } from "hono";

/** 200 only while the Discord gateway connection is ready; Railway's health check hits this. */
export function healthRoute(isReady: () => boolean): Hono {
  const app = new Hono();
  app.get("/health", (c) => (isReady() ? c.json({ ok: true }) : c.json({ ok: false }, 503)));
  return app;
}
