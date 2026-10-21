import { Hono } from "hono";
import { createLogger, type Logger } from "../logger.js";
import type { RevokeResult } from "../roles/revoke.js";
import { secretMatches } from "./secret.js";

export const SECRET_HEADER = "x-reiblast-bot-secret";
const SNOWFLAKE_RE = /^\d{15,25}$/;

export interface RevokeRouteDeps {
  /** DISCORD_BOT_OUTBOUND_SECRET */
  secret: string;
  isDiscordReady: () => boolean;
  revoke: (discordUserId: string) => Promise<RevokeResult>;
  /** Drops any in-memory verify session + verified flag for this Discord ID. */
  forgetUser: (discordUserId: string) => void;
  /** Reason-code-only staff alert (deduped, non-throwing). */
  alert?: (code: string) => void;
  logger?: Logger;
}

type Result = "ok" | "error";

/**
 * POST /revoke — server → bot. Always HTTP 200; `result` + `reason` carry the outcome (see docs/revoke-contract.md).
 * Logs reason codes only: never the Discord ID, the body, or the secret.
 */
export function revokeRoute(deps: RevokeRouteDeps): Hono {
  const log = deps.logger ?? createLogger("revoke");
  const app = new Hono();

  app.post("/revoke", async (c) => {
    const respond = (result: Result, reason: string) => {
      log.info("revoke", { result, reason });
      return c.json({ result, reason });
    };

    const provided = c.req.header(SECRET_HEADER);
    if (!provided) return respond("error", "auth_missing");
    if (!secretMatches(provided, deps.secret)) return respond("error", "auth_failed");

    try {
      let body: unknown;
      try {
        body = JSON.parse(await c.req.text());
      } catch {
        return respond("error", "bad_json");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) return respond("error", "bad_json");

      const id = (body as Record<string, unknown>).discordUserId;
      if (typeof id !== "string" || !SNOWFLAKE_RE.test(id)) return respond("error", "bad_request");

      // The server has declared this member revoked: kill any in-progress verify so "I agree" can't hand the role
      // back — even if the Discord call below fails and the server has to retry.
      deps.forgetUser(id);

      if (!deps.isDiscordReady()) return respond("error", "discord_unavailable");

      const outcome = await deps.revoke(id);
      if (outcome.status === "failed") {
        if (outcome.reason === "missing_permissions") deps.alert?.("revoke_missing_permissions");
        return respond("error", "discord_unavailable");
      }
      const reason = outcome.status === "revoked" ? "revoked" : outcome.status;
      return respond("ok", reason);
    } catch (err) {
      log.error("revoke handler failed", { error: err instanceof Error ? err.name : "unknown" });
      return respond("error", "internal_error");
    }
  });

  return app;
}
