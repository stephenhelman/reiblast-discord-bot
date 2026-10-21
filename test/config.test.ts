import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";

const base: NodeJS.ProcessEnv = {
  DISCORD_BOT_TOKEN: "tok-SECRETVALUE",
  DISCORD_APPLICATION_ID: "100000000000000001",
  DISCORD_GUILD_ID: "100000000000000002",
  DISCORD_REIBLAST_ROLE_ID: "100000000000000003",
  DISCORD_VERIFY_CHANNEL_ID: "100000000000000004",
  DISCORD_STAFF_ROLE_ID: "100000000000000005",
  DISCORD_STAFF_LOG_CHANNEL_ID: "100000000000000006",
  DISCORD_SUPPORT_FORUM_ID: "100000000000000007",
  DISCORD_TAG_SUPPORT_ID: "100000000000000008",
  DISCORD_TAG_RESOLVED_ID: "100000000000000009",
  DISCORD_TAG_NEEDS_STAFF_ID: "100000000000000010",
  DISCORD_SUPPORT_CHANNEL_ID: "100000000000000011",
  DISCORD_SUPPORT_ROLE_ID: "100000000000000012",
  ANTHROPIC_API_KEY: "sk-ant-SECRETVALUE",
  REIBLAST_SERVER_URL: "https://example.test/",
  DISCORD_BOT_INBOUND_SECRET: "in-secret",
  DISCORD_BOT_OUTBOUND_SECRET: "out-secret",
  SUPPORT_PHONE: "555",
};

function failure(env: NodeJS.ProcessEnv): string {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("exit");
  }) as never);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => loadConfig(env)).toThrow("exit");
  expect(exit).toHaveBeenCalledWith(1);
  return err.mock.calls.map((c) => String(c[0])).join("\n");
}

afterEach(() => vi.restoreAllMocks());

describe("loadConfig (Q&A settings)", () => {
  it("accepts a full environment", () => {
    const c = loadConfig(base);
    expect(c.DISCORD_SUPPORT_FORUM_ID).toBe("100000000000000007");
    expect(c.DISCORD_SUPPORT_ROLE_ID).toBe("100000000000000012");
  });

  it.each([
    "DISCORD_SUPPORT_FORUM_ID",
    "DISCORD_TAG_SUPPORT_ID",
    "DISCORD_TAG_RESOLVED_ID",
    "DISCORD_TAG_NEEDS_STAFF_ID",
    "DISCORD_SUPPORT_CHANNEL_ID",
    "DISCORD_SUPPORT_ROLE_ID",
    "ANTHROPIC_API_KEY",
  ])("requires %s and names it without echoing values", (name) => {
    const env = { ...base };
    delete env[name];
    const out = failure(env);
    expect(out).toContain(name);
    expect(out).not.toContain("SECRETVALUE");
  });

  it("rejects non-snowflake IDs without echoing the value", () => {
    const out = failure({ ...base, DISCORD_SUPPORT_CHANNEL_ID: "not-an-id-SECRETVALUE" });
    expect(out).toContain("DISCORD_SUPPORT_CHANNEL_ID");
    expect(out).not.toContain("SECRETVALUE");
  });

  it("requires the three tag IDs to differ", () => {
    const out = failure({ ...base, DISCORD_TAG_RESOLVED_ID: base.DISCORD_TAG_SUPPORT_ID });
    expect(out).toContain("DISCORD_TAG_NEEDS_STAFF_ID");
  });
});
