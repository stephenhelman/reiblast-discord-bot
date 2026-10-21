import { GatewayIntentBits, type ButtonInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createDiscordClient } from "../src/discord/client.js";
import { createQa } from "../src/discord/qa-setup.js";
import { loadKb } from "../src/kb/load.js";

const env: NodeJS.ProcessEnv = {
  DISCORD_BOT_TOKEN: "tok",
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
  ANTHROPIC_API_KEY: "sk-ant-test",
  REIBLAST_SERVER_URL: "https://example.test",
  DISCORD_BOT_INBOUND_SECRET: "in-secret",
  DISCORD_BOT_OUTBOUND_SECRET: "out-secret",
  SUPPORT_PHONE: "555",
};

describe("Discord client", () => {
  it("has the intents the Q&A feature needs, and a no-ping default for every message", () => {
    const client = createDiscordClient();
    const intents = client.options.intents;
    for (const flag of [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]) {
      expect(intents.has(flag)).toBe(true);
    }
    expect(intents.has(GatewayIntentBits.GuildPresences)).toBe(false);
    expect(client.options.allowedMentions).toEqual({ parse: [] });
  });
});

describe("createQa", () => {
  const click = (customId: string) => ({ customId, isButton: () => true }) as unknown as ButtonInteraction;

  it("registers the two listeners", () => {
    const client = createDiscordClient();
    const qa = createQa(client, loadConfig(env), loadKb(), vi.fn());
    qa.registerListeners();
    expect(client.listenerCount("messageCreate")).toBe(1);
    expect(client.listenerCount("threadUpdate")).toBe(1);
  });

  it("builds its graph lazily, only once the bot user is known", async () => {
    const client = createDiscordClient();
    const qa = createQa(client, loadConfig(env), loadKb(), vi.fn());
    await expect(qa.buttons.answer(click("qa:solved"))).rejects.toThrow("gateway not ready");

    Object.defineProperty(client, "user", { value: { id: "100000000000000099" }, configurable: true });
    // once ready, clicks that aren't Q&A buttons fall through (return false) without touching Discord
    expect(await qa.buttons.answer(click("verify:agree"))).toBe(false);
    expect(await qa.buttons.staff(click("verify:agree"))).toBe(false);
  });
});
