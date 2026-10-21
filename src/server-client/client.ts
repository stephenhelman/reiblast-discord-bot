import { z } from "zod";
import { createLogger, type Logger } from "../logger.js";
import type { ConfirmOutcome, Identifier, ServerClient, StartOutcome, UnlinkOutcome } from "./types.js";

const SECRET_HEADER = "x-reiblast-discord-secret";
const VERCEL_BYPASS_HEADER = "x-vercel-protection-bypass";
const DEFAULT_TIMEOUT_MS = 10_000;

const errorReason = z.enum([
  "auth_missing",
  "auth_failed",
  "server_misconfigured",
  "bad_json",
  "bad_request",
  "internal_error",
]);
const errorSchema = z.object({ result: z.literal("error"), reason: errorReason });
const linkedSchema = z.object({ result: z.literal("linked"), reason: z.literal("linked") });

const startSchema = z.union([
  z.object({ result: z.literal("code_sent"), reason: z.literal("code_sent"), phoneLast4: z.string().regex(/^\d{4}$/) }),
  linkedSchema,
  z.object({
    result: z.literal("refused"),
    reason: z.enum(["already_linked", "not_eligible", "rate_limited", "delivery_failed"]),
  }),
  errorSchema,
]);

const confirmSchema = z.union([
  linkedSchema,
  z.object({
    result: z.literal("refused"),
    reason: z.enum(["already_linked", "not_eligible", "rate_limited", "code_expired", "code_locked"]),
  }),
  z.object({
    result: z.literal("refused"),
    reason: z.literal("invalid_code"),
    attemptsRemaining: z.number().int().min(0).optional(),
  }),
  errorSchema,
]);

const unlinkSchema = z.union([
  z.object({ result: z.literal("unlinked"), reason: z.literal("unlinked") }),
  z.object({ result: z.literal("not_linked"), reason: z.literal("not_linked") }),
  errorSchema,
]);

export interface ServerClientOptions {
  baseUrl: string;
  secret: string;
  /** Vercel "Protection Bypass for Automation" secret, for protected preview deployments. Omit in production. */
  vercelBypassSecret?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  logger?: Logger;
}

type Cause = "timeout" | "network" | "unparseable";
const INTERNAL_ERROR = { result: "error", reason: "internal_error" } as const;

export function createServerClient(opts: ServerClientOptions): ServerClient {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = opts.logger ?? createLogger("server-client");

  /**
   * POSTs and parses against `schema`. Never branches on the HTTP status (the contract is always-200; the body is
   * the truth). Any transport failure, timeout, or body that isn't a known response shape becomes `internal_error`.
   * Logs the endpoint and reason only — never the request body, the response body, or any secret.
   */
  async function call<T extends { result: string; reason: string }>(
    endpoint: "verify-start" | "verify-confirm" | "unlink",
    path: string,
    body: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T | typeof INTERNAL_ERROR> {
    let text: string;
    try {
      const res = await doFetch(`${opts.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SECRET_HEADER]: opts.secret,
          ...(opts.vercelBypassSecret ? { [VERCEL_BYPASS_HEADER]: opts.vercelBypassSecret } : {}),
        },
        body: JSON.stringify(body),
        redirect: "error", // never forward the secret header to a redirect target
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return fail(endpoint, timedOut ? "timeout" : "network");
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return fail(endpoint, "unparseable");
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return fail(endpoint, "unparseable");

    log.info("response", { endpoint, reason: parsed.data.reason });
    return parsed.data;
  }

  function fail(endpoint: string, cause: Cause): typeof INTERNAL_ERROR {
    log.warn("request failed", { endpoint, reason: "internal_error", cause });
    return INTERNAL_ERROR;
  }

  const idBody = (discordUserId: string, id: Identifier): Record<string, string> => ({
    discordUserId,
    [id.kind]: id.value,
  });

  return {
    verifyStart: (discordUserId, identifier) =>
      call("verify-start", "/api/discord/verify/start", idBody(discordUserId, identifier), startSchema) as Promise<StartOutcome>,
    verifyConfirm: (discordUserId, identifier, code) =>
      call(
        "verify-confirm",
        "/api/discord/verify/confirm",
        { ...idBody(discordUserId, identifier), code },
        confirmSchema,
      ) as Promise<ConfirmOutcome>,
    unlink: (discordUserId) =>
      call("unlink", "/api/discord/unlink", { discordUserId }, unlinkSchema) as Promise<UnlinkOutcome>,
  };
}
