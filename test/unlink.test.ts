import { MessageFlags } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createServerClient } from "../src/server-client/client.js";
import { createSessionStore } from "../src/verify/session.js";
import { createUnlinkHandler, type UnlinkInteractionLike } from "../src/verify/unlink.js";
import type { RevokeResult } from "../src/roles/revoke.js";
import type { UnlinkOutcome } from "../src/server-client/types.js";
import type { Logger } from "../src/logger.js";

const GUILD = "111111111111111111";
const STAFF = "222222222222222222";
const TARGET = "987654321098765432";

function logs() {
  const lines: string[] = [];
  const push = (m: string, f?: Record<string, unknown>) => lines.push(`${m} ${JSON.stringify(f ?? {})}`);
  const logger: Logger = { debug: push, info: push, warn: push, error: push };
  return { lines, logger };
}

function interaction(over: Partial<UnlinkInteractionLike> = {}) {
  return {
    guildId: GUILD,
    member: { roles: [STAFF] },
    options: { getUser: () => ({ id: TARGET }) },
    reply: vi.fn(async () => {}),
    deferReply: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
    ...over,
  } satisfies UnlinkInteractionLike;
}

function setup(outcome: UnlinkOutcome, revoke: RevokeResult = { status: "revoked" }) {
  const { lines, logger } = logs();
  const sessions = createSessionStore();
  const unlink = vi.fn(async (_id: string) => outcome);
  const revokeFn = vi.fn(async (_id: string) => revoke);
  const alert = vi.fn();
  const handler = createUnlinkHandler({
    guildId: GUILD,
    staffRoleId: STAFF,
    serverClient: { unlink },
    revoke: revokeFn,
    forgetUser: (id) => {
      sessions.clearPending(id);
      sessions.clearVerified(id);
    },
    alert,
    logger,
  });
  return { handler, unlink, revokeFn, alert, sessions, lines };
}
const reply = (i: ReturnType<typeof interaction>) =>
  ((i.editReply as unknown as { mock: { calls: [{ content: string }][] } }).mock.calls.at(-1) as [{ content: string }])[0].content;

describe("/unlink staff gating", () => {
  it("denies non-staff, wrong guild, and DMs without touching the server", async () => {
    for (const over of [{ member: { roles: ["999999999999999999"] } }, { guildId: "333333333333333333" }, { guildId: null }, { member: null }]) {
      const s = setup({ result: "unlinked", reason: "unlinked" });
      const i = interaction(over);
      await s.handler(i);
      expect(i.reply).toHaveBeenCalledWith({ content: expect.stringContaining("staff"), flags: MessageFlags.Ephemeral });
      expect(i.deferReply).not.toHaveBeenCalled();
      expect(s.unlink).not.toHaveBeenCalled();
      expect(s.revokeFn).not.toHaveBeenCalled();
    }
  });

  it("staff defer ephemerally first", async () => {
    const s = setup({ result: "unlinked", reason: "unlinked" });
    const i = interaction();
    await s.handler(i);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(s.unlink).toHaveBeenCalledWith(TARGET);
  });
});

describe("server reasons", () => {
  it("unlinked + role removed", async () => {
    const s = setup({ result: "unlinked", reason: "unlinked" });
    const i = interaction();
    await s.handler(i);
    expect(reply(i)).toBe("Unlinked and role removed — they can verify again with a new account.");
    expect(s.alert).not.toHaveBeenCalled();
  });

  it("not_linked still removes the role", async () => {
    const s = setup({ result: "not_linked", reason: "not_linked" });
    const i = interaction();
    await s.handler(i);
    expect(s.revokeFn).toHaveBeenCalledWith(TARGET);
    expect(reply(i)).toContain("weren't linked");
    expect(reply(i)).toContain("role removed");
  });

  it.each(["auth_missing", "auth_failed", "server_misconfigured", "bad_json", "bad_request", "internal_error"] as const)(
    "%s: generic reply, alert, no role removal, no session clearing",
    async (reason) => {
      const s = setup({ result: "error", reason });
      s.sessions.markVerified(TARGET);
      const i = interaction();
      await s.handler(i);
      expect(reply(i)).toContain("try again");
      expect(s.alert).toHaveBeenCalledWith(reason);
      expect(s.revokeFn).not.toHaveBeenCalled();
      expect(s.sessions.isVerified(TARGET)).toBe(true);
    },
  );
});

describe("role removal outcomes", () => {
  it("not_in_guild and not_holding_role are fine", async () => {
    for (const [status, text] of [["not_in_guild", "not in the server"], ["not_holding_role", "didn't hold the role"]] as const) {
      const s = setup({ result: "unlinked", reason: "unlinked" }, { status });
      const i = interaction();
      await s.handler(i);
      expect(reply(i)).toContain(text);
      expect(reply(i)).toContain("verify again");
      expect(s.alert).not.toHaveBeenCalled();
    }
  });

  it.each(["missing_permissions", "discord_unavailable"] as const)("%s: tells staff and alerts", async (reason) => {
    const s = setup({ result: "unlinked", reason: "unlinked" }, { status: "failed", reason });
    const i = interaction();
    await s.handler(i);
    expect(reply(i)).toContain("link was cleared");
    expect(reply(i)).toContain("couldn't remove their role");
    expect(s.alert).toHaveBeenCalledWith(`unlink_role_${reason}`);
  });

  it("a thrown error is reported, not propagated", async () => {
    const s = setup({ result: "unlinked", reason: "unlinked" });
    s.revokeFn.mockRejectedValueOnce(new Error("boom"));
    const i = interaction();
    await expect(s.handler(i)).resolves.toBeUndefined();
    expect(reply(i)).toContain("try again");
  });
});

describe("session clearing", () => {
  it("clears pending and verified on unlinked and not_linked, even when role removal fails", async () => {
    const cases: [UnlinkOutcome, RevokeResult][] = [
      [{ result: "unlinked", reason: "unlinked" }, { status: "revoked" }],
      [{ result: "not_linked", reason: "not_linked" }, { status: "not_in_guild" }],
      [{ result: "unlinked", reason: "unlinked" }, { status: "failed", reason: "discord_unavailable" }],
    ];
    for (const [outcome, rv] of cases) {
      const s = setup(outcome, rv);
      s.sessions.begin(TARGET, { kind: "email", value: "a@b.co" });
      s.sessions.markVerified(TARGET);
      s.sessions.begin(TARGET, { kind: "email", value: "a@b.co" });
      await s.handler(interaction());
      expect(s.sessions.pending(TARGET)).toBeUndefined();
      expect(s.sessions.isVerified(TARGET)).toBe(false);
    }
  });
});

describe("log hygiene", () => {
  it("never logs the target ID, and logs reason codes", async () => {
    for (const [outcome, rv] of [
      [{ result: "unlinked", reason: "unlinked" }, { status: "revoked" }],
      [{ result: "error", reason: "auth_failed" }, { status: "revoked" }],
      [{ result: "unlinked", reason: "unlinked" }, { status: "failed", reason: "missing_permissions" }],
    ] as [UnlinkOutcome, RevokeResult][]) {
      const s = setup(outcome, rv);
      await s.handler(interaction());
      expect(s.lines.length).toBeGreaterThan(0);
      expect(s.lines.join("\n")).not.toContain(TARGET);
    }
  });

  it("denial log has no IDs", async () => {
    const s = setup({ result: "unlinked", reason: "unlinked" });
    await s.handler(interaction({ member: { roles: [] } }));
    expect(s.lines.join("\n")).not.toContain(TARGET);
  });
});

describe("server client unlink", () => {
  const SECRET = "test-secret-value";
  const make = (impl: (...a: Parameters<typeof fetch>) => Promise<Response>, bypass?: string) => {
    const fetchMock = vi.fn(impl);
    const lines: string[] = [];
    const push = (m: string, f?: Record<string, unknown>) => lines.push(`${m} ${JSON.stringify(f ?? {})}`);
    const client = createServerClient({
      baseUrl: "https://app.example.com",
      secret: SECRET,
      vercelBypassSecret: bypass,
      fetch: fetchMock as unknown as typeof fetch,
      logger: { debug: push, info: push, warn: push, error: push },
      timeoutMs: 50,
    });
    return { client, fetchMock, lines };
  };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

  it("posts only discordUserId with secret, no redirects, optional bypass header", async () => {
    const { client, fetchMock } = make(async () => json({ result: "unlinked", reason: "unlinked" }), "bypass");
    expect(await client.unlink(TARGET)).toEqual({ result: "unlinked", reason: "unlinked" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://app.example.com/api/discord/unlink");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    const h = init?.headers as Record<string, string>;
    expect(h["x-reiblast-discord-secret"]).toBe(SECRET);
    expect(h["x-vercel-protection-bypass"]).toBe("bypass");
    expect(JSON.parse(init?.body as string)).toEqual({ discordUserId: TARGET });
  });

  it("omits the bypass header by default and parses not_linked + error reasons", async () => {
    const a = make(async () => json({ result: "not_linked", reason: "not_linked" }));
    expect(await a.client.unlink(TARGET)).toEqual({ result: "not_linked", reason: "not_linked" });
    expect(a.fetchMock.mock.calls[0]![1]?.headers).not.toHaveProperty("x-vercel-protection-bypass");
    const b = make(async () => json({ result: "error", reason: "auth_failed" }));
    expect(await b.client.unlink(TARGET)).toEqual({ result: "error", reason: "auth_failed" });
  });

  it("ignores HTTP status; garbage, network failure, and timeout become internal_error; nothing logs the ID", async () => {
    const internal = { result: "error", reason: "internal_error" };
    const ok = make(async () => json({ result: "unlinked", reason: "unlinked" }, 500));
    expect(await ok.client.unlink(TARGET)).toEqual({ result: "unlinked", reason: "unlinked" });
    const bad = make(async () => new Response("<html>"));
    expect(await bad.client.unlink(TARGET)).toEqual(internal);
    const odd = make(async () => json({ result: "linked", reason: "linked" }));
    expect(await odd.client.unlink(TARGET)).toEqual(internal);
    const net = make(async () => { throw new TypeError("fetch failed"); });
    expect(await net.client.unlink(TARGET)).toEqual(internal);
    const slow = make((_u, init) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason))));
    expect(await slow.client.unlink(TARGET)).toEqual(internal);
    for (const m of [ok, bad, odd, net, slow]) expect(m.lines.join("\n")).not.toContain(TARGET);
  });
});
