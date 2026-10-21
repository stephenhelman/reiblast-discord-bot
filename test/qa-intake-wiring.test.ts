import type { ButtonInteraction } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createDiscordClient } from "../src/discord/client.js";
import { createQa } from "../src/discord/qa-setup.js";
import { loadKb } from "../src/kb/load.js";
import { QA_TEXT } from "../src/qa/messages.js";

const BOT = "100000000000000099";
const OP = "100000000000000002";
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

const msg = (id: string, authorId: string, content: string) => [id, { id, author: { id: authorId }, content, system: false }] as const;

/** A forum post where the bot already asked two diagnose questions (so this is a troubleshooting thread). */
function threadWith(extra: Array<readonly [string, object]> = []) {
  const sent: Array<{ content: string; allowedMentions: unknown }> = [];
  const t = {
    id: "700000000000000010",
    name: "Texts not sending",
    url: "https://discord.com/channels/1/700000000000000010",
    ownerId: OP,
    appliedTags: [env.DISCORD_TAG_SUPPORT_ID!],
    isThread: () => true,
    setAppliedTags: vi.fn(async (_t: string[]) => {}),
    send: vi.fn(async (m: { content: string; allowedMentions: unknown }) => void sent.push(m)),
    messages: {
      fetch: vi.fn(
        async () =>
          new Map([
            msg("700000000000000010", OP, "my texts aren't sending"),
            msg("800000000000000001", BOT, "Go to Settings, then Phone System. What color is the banner?\n-# Check 1 of 4"),
            msg("800000000000000002", OP, "it's green"),
            msg("800000000000000003", BOT, "Go to Settings, then Billing. Is your balance above zero?\n-# Check 2 of 4"),
            ...extra,
          ]),
      ),
    },
    fetchStarterMessage: vi.fn(async () => null),
  };
  return { t, sent };
}

const help = (channel: unknown) =>
  ({
    customId: "qa:help",
    user: { id: OP },
    member: { roles: [] },
    channel,
    deferUpdate: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    reply: vi.fn(async () => {}),
  }) as unknown as ButtonInteraction;

function anthropicReply(summary: string) {
  const body = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: JSON.stringify({ outcome: "not_covered", reply: "", kbIds: [], summary }) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function build() {
  const client = createDiscordClient();
  Object.defineProperty(client, "user", { value: { id: BOT }, configurable: true });
  // No real Discord traffic: the staff-log channel is a stub
  const staffLogSends: string[] = [];
  (client.channels as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({ isSendable: () => true, send: async (m: { content: string }) => void staffLogSends.push(m.content) }));
  const alert = vi.fn();
  const qa = createQa(client, loadConfig(env), loadKb(), alert);
  return { qa, alert, staffLogSends };
}

afterEach(() => vi.unstubAllGlobals());

describe("'Still need help' on a troubleshooting thread, after a restart (nothing remembered)", () => {
  it("regenerates the summary with one model call, then posts the hand-off, the labelled summary and the intake ask", async () => {
    const requests: Array<{ system: unknown; messages: Array<{ role: string; content: string }> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => {
      requests.push(JSON.parse(init.body));
      return anthropicReply("Member says texts aren't sending; the banner is green and they have not checked the wallet.");
    }));
    const { qa, alert, staffLogSends } = build();
    const { t, sent } = threadWith();

    expect(await qa.buttons.answer(help(t))).toBe(true);

    expect(requests).toHaveLength(1); // exactly one extra model call
    const last = requests[0]!.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toContain("it's green"); // built from the thread, ending on the member's last words
    expect(JSON.stringify(requests[0])).not.toContain("-# Check"); // markers never reach the model
    expect(t.setAppliedTags).toHaveBeenCalledWith([env.DISCORD_TAG_NEEDS_STAFF_ID], expect.any(String));
    expect(sent.map((m) => m.content)).toEqual([
      QA_TEXT.handoff(env.DISCORD_SUPPORT_ROLE_ID!),
      `${QA_TEXT.caseSummaryLabel}\nMember says texts aren't sending; the banner is green and they have not checked the wallet.`,
      QA_TEXT.intakeAsk,
    ]);
    expect(sent[0]!.allowedMentions).toEqual({ parse: [], roles: [env.DISCORD_SUPPORT_ROLE_ID] }); // the only ping
    expect(sent[1]!.allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(alert).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(staffLogSends.join("\n")).toContain("help_button");
    expect(staffLogSends.join("\n")).not.toContain("banner");
  });

  it("if the extra call fails, hands off anyway: template and intake ask, no summary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } }), { status: 401, headers: { "content-type": "application/json" } })));
    const { qa } = build();
    const { t, sent } = threadWith();
    await qa.buttons.answer(help(t));
    expect(sent.map((m) => m.content)).toEqual([QA_TEXT.handoff(env.DISCORD_SUPPORT_ROLE_ID!), QA_TEXT.intakeAsk]);
    expect(t.setAppliedTags).toHaveBeenCalled();
  });

  it("a thread with no diagnose question gets today's plain hand-off and no model call at all", async () => {
    const fetchSpy = vi.fn(async () => anthropicReply("unused"));
    vi.stubGlobal("fetch", fetchSpy);
    const { qa } = build();
    const { t, sent } = threadWith();
    t.messages.fetch.mockResolvedValue(new Map([msg("700000000000000010", OP, "how do I import leads?"), msg("800000000000000001", BOT, "Go to Contacts, then Import.")]));
    await qa.buttons.answer(help(t));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sent.map((m) => m.content)).toEqual([QA_TEXT.handoff(env.DISCORD_SUPPORT_ROLE_ID!)]);
  });
});
