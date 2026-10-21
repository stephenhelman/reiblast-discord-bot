import { describe, expect, it, vi } from "vitest";
import { createStaffAlerter } from "../src/discord/staff-alert.js";
import { createRoleGranter, type GuildLike } from "../src/roles/grant.js";
import type { Logger } from "../src/logger.js";

const ROLE = "444444444444444444";
const quietLog: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function granter(opts: { has?: boolean; fetchError?: unknown; addError?: unknown; guildError?: unknown }) {
  const add = vi.fn(async () => {
    if (opts.addError) throw opts.addError;
  });
  const guild: GuildLike = {
    members: {
      fetch: async () => {
        if (opts.fetchError) throw opts.fetchError;
        return { roles: { cache: { has: () => opts.has ?? false }, add } };
      },
    },
  };
  const grant = createRoleGranter({
    getGuild: async () => {
      if (opts.guildError) throw opts.guildError;
      return guild;
    },
    roleId: ROLE,
  });
  return { grant, add };
}
const apiError = (code: number) => Object.assign(new Error("Discord API error"), { code });

describe("createRoleGranter", () => {
  it("grants the role", async () => {
    const { grant, add } = granter({});
    expect(await grant("u1")).toEqual({ status: "granted" });
    expect(add).toHaveBeenCalledWith(ROLE, expect.any(String));
  });

  it("is a no-op when the member already has the role", async () => {
    const { grant, add } = granter({ has: true });
    expect(await grant("u1")).toEqual({ status: "already_had" });
    expect(add).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown member on fetch (left the server)", { fetchError: apiError(10007) }, "member_not_found"],
    ["unknown member on add", { addError: apiError(10007) }, "member_not_found"],
    ["missing permissions / bot role too low", { addError: apiError(50013) }, "missing_permissions"],
    ["missing access", { addError: apiError(50001) }, "missing_permissions"],
    ["unknown role", { addError: apiError(10011) }, "role_not_found"],
    ["other discord error", { addError: apiError(40001) }, "discord_unavailable"],
    ["non-discord error", { fetchError: new Error("socket hang up") }, "discord_unavailable"],
    ["guild unavailable", { guildError: new Error("not ready") }, "discord_unavailable"],
  ])("%s → failed:%s (never throws)", async (_n, opts, reason) => {
    const { grant } = granter(opts);
    expect(await grant("u1")).toEqual({ status: "failed", reason });
  });
});

describe("createStaffAlerter", () => {
  async function flush() {
    await new Promise((r) => setImmediate(r));
  }

  it("sends a reason-code-only message and dedupes the same code within the window", async () => {
    let t = 0;
    const send = vi.fn(async (_text: string) => {});
    const alert = createStaffAlerter({ send, now: () => t, dedupMs: 1000, logger: quietLog });
    alert("auth_failed");
    alert("auth_failed");
    alert("role_missing_permissions"); // different code → not deduped
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toContain("`auth_failed`");
    t = 1000;
    alert("auth_failed");
    await flush();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("never throws or rejects when the sender fails (sync or async)", async () => {
    const asyncFail = createStaffAlerter({ send: async () => { throw new Error("no channel"); }, logger: quietLog });
    const syncFail = createStaffAlerter({ send: () => { throw new Error("boom"); }, logger: quietLog });
    expect(() => asyncFail("a")).not.toThrow();
    expect(() => syncFail("b")).not.toThrow();
    await flush();
  });

  it("does not block the caller on a slow send", () => {
    const alert = createStaffAlerter({ send: () => new Promise(() => {}), logger: quietLog });
    expect(alert("slow")).toBeUndefined();
  });
});
