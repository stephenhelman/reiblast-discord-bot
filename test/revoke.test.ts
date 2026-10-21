import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/http/server.js";
import { secretMatches } from "../src/http/secret.js";
import type { Logger } from "../src/logger.js";
import { createRoleRevoker, type RevokeGuildLike, type RevokeResult } from "../src/roles/revoke.js";
import { createSessionStore } from "../src/verify/session.js";

const SECRET = "outbound-secret-value";
const TARGET = "123456789012345678";
const OTHER = "987654321098765432";
const email = { kind: "email", value: "member@example.com" } as const;

function setup(over: { ready?: boolean; result?: RevokeResult | Error } = {}) {
  const lines: string[] = [];
  const push = (m: string, f?: Record<string, unknown>) => lines.push(`${m} ${JSON.stringify(f ?? {})}`);
  const logger: Logger = { debug: push, info: push, warn: push, error: push };
  const sessions = createSessionStore();
  const revoke = vi.fn(async (_id: string): Promise<RevokeResult> => {
    if (over.result instanceof Error) throw over.result;
    return over.result ?? { status: "revoked" };
  });
  const alert = vi.fn();
  const app = buildApp({
    isDiscordReady: () => over.ready ?? true,
    revoke: {
      secret: SECRET,
      revoke,
      forgetUser: (id) => {
        sessions.clearPending(id);
        sessions.clearVerified(id);
      },
      alert,
      logger,
    },
  });
  const post = (body: string, headers: Record<string, string> = { "x-reiblast-bot-secret": SECRET }) =>
    app.request("/revoke", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  const postId = (...args: [] | [unknown]) => post(JSON.stringify({ discordUserId: args.length ? args[0] : TARGET }));
  return { app, post, postId, revoke, alert, sessions, lines };
}
async function json(res: Response): Promise<{ result: string; reason: string }> {
  expect(res.status).toBe(200); // contract: always 200
  return (await res.json()) as { result: string; reason: string };
}

describe("auth", () => {
  it("missing secret header → auth_missing, nothing happens", async () => {
    const { post, revoke } = setup();
    expect(await json(await post(JSON.stringify({ discordUserId: TARGET }), {}))).toEqual({ result: "error", reason: "auth_missing" });
    expect(revoke).not.toHaveBeenCalled();
  });

  it("empty secret header → auth_missing", async () => {
    const { post } = setup();
    expect(await json(await post(JSON.stringify({ discordUserId: TARGET }), { "x-reiblast-bot-secret": "" }))).toEqual({
      result: "error",
      reason: "auth_missing",
    });
  });

  it("wrong secret → auth_failed, and an unauthenticated caller can't clear sessions", async () => {
    const { post, revoke, sessions } = setup();
    sessions.markVerified(TARGET);
    const res = await post(JSON.stringify({ discordUserId: TARGET }), { "x-reiblast-bot-secret": "nope" });
    expect(await json(res)).toEqual({ result: "error", reason: "auth_failed" });
    expect(revoke).not.toHaveBeenCalled();
    expect(sessions.isVerified(TARGET)).toBe(true);
  });

  it("the other secret (inbound) is not accepted", async () => {
    const { post } = setup();
    expect((await json(await post(JSON.stringify({ discordUserId: TARGET }), { "x-reiblast-discord-secret": SECRET }))).reason).toBe(
      "auth_missing",
    );
  });

  it("secretMatches is exact, including different lengths and prefixes", () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches(SECRET + "x", SECRET)).toBe(false);
    expect(secretMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(secretMatches("", SECRET)).toBe(false);
  });
});

describe("request validation", () => {
  it.each([["not json{"], [""], ["[]"], ["null"], ['"str"'], ["42"]])("body %j → bad_json", async (body) => {
    const { post, revoke } = setup();
    expect(await json(await post(body))).toEqual({ result: "error", reason: "bad_json" });
    expect(revoke).not.toHaveBeenCalled();
  });

  it.each([[undefined], [123456789012345678], ["abc"], ["12345678901234"], ["1".repeat(26)], ["1234567890123456x8"], [""], [null], [["1"]]])(
    "discordUserId %j → bad_request",
    async (id) => {
      const { postId, revoke } = setup();
      expect(await json(await postId(id))).toEqual({ result: "error", reason: "bad_request" });
      expect(revoke).not.toHaveBeenCalled();
    },
  );

  it("a missing key entirely → bad_request", async () => {
    const { post } = setup();
    expect(await json(await post("{}"))).toEqual({ result: "error", reason: "bad_request" });
  });
});

describe("outcomes", () => {
  it("revoked", async () => {
    const { postId, revoke } = setup({ result: { status: "revoked" } });
    expect(await json(await postId())).toEqual({ result: "ok", reason: "revoked" });
    expect(revoke).toHaveBeenCalledWith(TARGET);
  });

  it("not_in_guild is a successful no-op", async () => {
    const { postId } = setup({ result: { status: "not_in_guild" } });
    expect(await json(await postId())).toEqual({ result: "ok", reason: "not_in_guild" });
  });

  it("not_holding_role is a successful no-op", async () => {
    const { postId } = setup({ result: { status: "not_holding_role" } });
    expect(await json(await postId())).toEqual({ result: "ok", reason: "not_holding_role" });
  });

  it("Discord API failure → discord_unavailable (retryable)", async () => {
    const { postId, alert } = setup({ result: { status: "failed", reason: "discord_unavailable" } });
    expect(await json(await postId())).toEqual({ result: "error", reason: "discord_unavailable" });
    expect(alert).not.toHaveBeenCalled();
  });

  it("missing permissions → discord_unavailable plus a staff alert", async () => {
    const { postId, alert } = setup({ result: { status: "failed", reason: "missing_permissions" } });
    expect(await json(await postId())).toEqual({ result: "error", reason: "discord_unavailable" });
    expect(alert).toHaveBeenCalledWith("revoke_missing_permissions");
  });

  it("gateway not ready → discord_unavailable without calling Discord", async () => {
    const { postId, revoke } = setup({ ready: false });
    expect(await json(await postId())).toEqual({ result: "error", reason: "discord_unavailable" });
    expect(revoke).not.toHaveBeenCalled();
  });

  it("an unexpected exception → internal_error, still HTTP 200", async () => {
    const { postId } = setup({ result: new Error("boom") });
    expect(await json(await postId())).toEqual({ result: "error", reason: "internal_error" });
  });

  it("is idempotent: repeating the call gives the same answer", async () => {
    const { postId } = setup({ result: { status: "not_holding_role" } });
    expect(await json(await postId())).toEqual(await json(await postId()));
  });
});

describe("in-flight verify state", () => {
  function seeded(over: Parameters<typeof setup>[0] = {}) {
    const s = setup(over);
    s.sessions.begin(TARGET, email);
    s.sessions.markVerified(TARGET);
    s.sessions.begin(TARGET, email); // both a pending session and a verified flag
    s.sessions.begin(OTHER, email);
    s.sessions.markVerified(OTHER);
    return s;
  }

  it.each([
    ["revoked", { result: { status: "revoked" } } as const],
    ["not_in_guild", { result: { status: "not_in_guild" } } as const],
    ["not_holding_role", { result: { status: "not_holding_role" } } as const],
  ])("%s clears the session and verified flag for that ID only", async (_n, over) => {
    const { postId, sessions } = seeded(over);
    await postId();
    expect(sessions.pending(TARGET)).toBeUndefined();
    expect(sessions.isVerified(TARGET)).toBe(false);
    expect(sessions.isVerified(OTHER)).toBe(true);
  });

  it("is also cleared when Discord fails or the gateway is down, so a retry window can't be exploited", async () => {
    for (const over of [{ result: { status: "failed", reason: "discord_unavailable" } }, { ready: false }] as const) {
      const { postId, sessions } = seeded(over);
      await postId();
      expect(sessions.pending(TARGET)).toBeUndefined();
      expect(sessions.isVerified(TARGET)).toBe(false);
    }
  });
});

describe("log hygiene", () => {
  it("never logs the Discord ID, the body, or either secret", async () => {
    const all: string[] = [];
    const scenarios = [
      {},
      { result: { status: "not_in_guild" } },
      { result: { status: "failed", reason: "missing_permissions" } },
      { result: new Error(`boom ${TARGET} ${SECRET}`) },
      { ready: false },
    ] as Parameters<typeof setup>[0][];
    for (const over of scenarios) {
      const s = setup(over);
      await s.postId();
      await s.post("not json");
      await s.post(JSON.stringify({ discordUserId: "bad" }));
      await s.post(JSON.stringify({ discordUserId: TARGET }), { "x-reiblast-bot-secret": "wrong-secret-xyz" });
      await s.post(JSON.stringify({ discordUserId: TARGET }), {});
      all.push(...s.lines);
    }
    const text = all.join("\n");
    expect(text).toContain('"reason":"revoked"');
    for (const forbidden of [TARGET, SECRET, "wrong-secret-xyz", "discordUserId"]) expect(text).not.toContain(forbidden);
  });
});

describe("createRoleRevoker", () => {
  const ROLE = "444444444444444444";
  const apiError = (code: number) => Object.assign(new Error("Discord API error"), { code });

  function revoker(o: { has?: boolean; fetchError?: unknown; removeError?: unknown; guildError?: unknown }) {
    const remove = vi.fn(async () => {
      if (o.removeError) throw o.removeError;
    });
    const fetch = vi.fn(async (_opts: { user: string; force: boolean }) => {
      if (o.fetchError) throw o.fetchError;
      return { roles: { cache: { has: () => o.has ?? true }, remove } };
    });
    const guild: RevokeGuildLike = { members: { fetch } };
    const run = createRoleRevoker({
      getGuild: async () => {
        if (o.guildError) throw o.guildError;
        return guild;
      },
      roleId: ROLE,
    });
    return { run, remove, fetch };
  }

  it("removes the role, forcing a fresh member fetch", async () => {
    const { run, remove, fetch } = revoker({});
    expect(await run("u1")).toEqual({ status: "revoked" });
    expect(remove).toHaveBeenCalledWith(ROLE, expect.any(String));
    expect(fetch).toHaveBeenCalledWith({ user: "u1", force: true });
  });

  it("not holding the role → no-op without a remove call", async () => {
    const { run, remove } = revoker({ has: false });
    expect(await run("u1")).toEqual({ status: "not_holding_role" });
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown member (left the server)", { fetchError: apiError(10007) }, { status: "not_in_guild" }],
    ["unknown member while removing", { removeError: apiError(10007) }, { status: "not_in_guild" }],
    ["missing permissions", { removeError: apiError(50013) }, { status: "failed", reason: "missing_permissions" }],
    ["missing access", { removeError: apiError(50001) }, { status: "failed", reason: "missing_permissions" }],
    ["other discord error", { removeError: apiError(40001) }, { status: "failed", reason: "discord_unavailable" }],
    ["network error", { fetchError: new Error("socket hang up") }, { status: "failed", reason: "discord_unavailable" }],
    ["guild unavailable", { guildError: new Error("not ready") }, { status: "failed", reason: "discord_unavailable" }],
  ])("%s (never throws)", async (_n, opts, expected) => {
    const { run } = revoker(opts);
    expect(await run("u1")).toEqual(expected);
  });
});
