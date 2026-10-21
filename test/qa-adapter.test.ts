import { ChannelType, PermissionFlagsBits, PermissionsBitField, type ButtonInteraction, type Client, type Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import {
  checkQaSetup,
  createFetchOldest,
  fetchThreadMessages,
  loadStarter,
  toAnswerButton,
  toQaMessage,
  toStaffButton,
  type QaIds,
} from "../src/discord/qa-adapter.js";
import type { OutgoingMessage } from "../src/qa/post.js";

const BOT = "100000000000000001";
const OP = "100000000000000002";
const GUILD = "111111111111111111";
const FORUM = "222222222222222221";
const SUPPORT = "222222222222222222";
const STAFF_ROLE = "333333333333333331";
const SUPPORT_ROLE = "333333333333333332";
const ids: QaIds = {
  guildId: GUILD,
  forumId: FORUM,
  supportChannelId: SUPPORT,
  staffRoleId: STAFF_ROLE,
  supportRoleId: SUPPORT_ROLE,
  tags: { tagSupportId: "T_SUP", tagResolvedId: "T_RES", tagNeedsStaffId: "T_STAFF" },
};

const outgoing: OutgoingMessage = { content: "hi", allowedMentions: { parse: [], repliedUser: false } };

function thread(over: Record<string, unknown> = {}) {
  return {
    id: "900",
    name: "Texts not sending",
    parentId: FORUM,
    ownerId: OP,
    appliedTags: ["T_SUP"],
    isThread: () => true,
    isSendable: () => true,
    send: vi.fn(async (_m?: unknown) => {}),
    sendTyping: vi.fn(async () => {}),
    messages: { fetch: vi.fn(async () => new Map()) },
    fetchStarterMessage: vi.fn(async () => null),
    ...over,
  };
}

function plainChannel(id = "c1") {
  return { id, isThread: () => false, isSendable: () => true, send: vi.fn(async (_m?: unknown) => {}), sendTyping: vi.fn(async () => {}) };
}

function msg(over: Record<string, unknown> = {}, channel: ReturnType<typeof thread> | ReturnType<typeof plainChannel> = thread()) {
  return {
    id: "m1",
    content: "my texts won't send",
    partial: false,
    guildId: GUILD,
    inGuild: () => true,
    webhookId: null,
    system: false,
    author: { id: OP, bot: false, displayName: "Jane G" },
    member: { displayName: "Jane", roles: { cache: { has: (_id: string) => false } } },
    channel,
    reply: vi.fn(async () => {}),
    ...over,
  } as unknown as Message;
}

describe("toQaMessage: where", () => {
  it("a forum post's first message", () => {
    const m = toQaMessage(msg({ id: "900" }), ids, BOT)!;
    expect(m.facts.where).toEqual({ kind: "forum-thread", ownerId: OP, appliedTags: ["T_SUP"], isStarter: true });
    expect(m.thread).not.toBeNull();
    expect(m.title).toBe("Texts not sending");
  });

  it("a later message in a forum post", () => {
    expect(toQaMessage(msg(), ids, BOT)!.facts.where).toMatchObject({ kind: "forum-thread", isStarter: false });
  });

  it("the Support channel and private threads under it are 'support-channel'", () => {
    expect(toQaMessage(msg({}, plainChannel(SUPPORT)), ids, BOT)!.facts.where.kind).toBe("support-channel");
    expect(toQaMessage(msg({}, thread({ parentId: SUPPORT })), ids, BOT)!.facts.where.kind).toBe("support-channel");
  });

  it("chat channels and threads under other parents are 'other'", () => {
    const chat = toQaMessage(msg({}, plainChannel()), ids, BOT)!;
    expect(chat.facts.where.kind).toBe("other");
    expect(chat.thread).toBeNull();
    expect(toQaMessage(msg({}, thread({ parentId: "999999999999999999" })), ids, BOT)!.facts.where.kind).toBe("other");
  });

  it("returns null for partial messages and channels it can't send to", () => {
    expect(toQaMessage(msg({ partial: true }), ids, BOT)).toBeNull();
    expect(toQaMessage(msg({}, { ...plainChannel(), isSendable: () => false }), ids, BOT)).toBeNull();
  });
});

describe("toQaMessage: facts", () => {
  const facts = (over: Record<string, unknown> = {}, channel?: ReturnType<typeof thread>) => toQaMessage(msg(over, channel), ids, BOT)!.facts;

  it("inGuild is false for other guilds and DMs", () => {
    expect(facts({ guildId: "999999999999999999" }).inGuild).toBe(false);
    expect(facts({ inGuild: () => false }).inGuild).toBe(false);
    expect(facts().inGuild).toBe(true);
  });

  it("bots, webhooks, system messages and the bot itself are all 'bot authors'", () => {
    expect(facts().authorIsBot).toBe(false);
    expect(facts({ author: { id: OP, bot: true, displayName: "x" } }).authorIsBot).toBe(true);
    expect(facts({ webhookId: "123" }).authorIsBot).toBe(true);
    expect(facts({ system: true }).authorIsBot).toBe(true);
    expect(facts({ author: { id: BOT, bot: false, displayName: "me" } }).authorIsBot).toBe(true);
  });

  it("staff = the staff role or the support role", () => {
    const withRole = (role: string) => ({ member: { displayName: "S", roles: { cache: { has: (id: string) => id === role } } } });
    expect(facts(withRole(STAFF_ROLE)).authorIsStaff).toBe(true);
    expect(facts(withRole(SUPPORT_ROLE)).authorIsStaff).toBe(true);
    expect(facts(withRole("other")).authorIsStaff).toBe(false);
    expect(facts({ member: null }).authorIsStaff).toBe(false);
  });

  it("mentionsBot looks for a direct mention of this bot only", () => {
    expect(facts({ content: `<@${BOT}> help` }).mentionsBot).toBe(true);
    expect(facts({ content: `help <@!${BOT}>` }).mentionsBot).toBe(true);
    expect(facts({ content: "<@100000000000000099> help" }).mentionsBot).toBe(false);
    expect(facts({ content: "@everyone help <@&333333333333333332>" }).mentionsBot).toBe(false);
  });

  it("hasText: a bare mention or attachment-only message has nothing to answer; a title-only starter does", () => {
    expect(facts({ content: `<@${BOT}>` }).hasText).toBe(false);
    expect(facts({ content: "" }).hasText).toBe(false);
    expect(facts({ id: "900", content: "" }).hasText).toBe(true);
    expect(facts({ content: "real text" }).hasText).toBe(true);
  });
});

describe("toQaMessage: posting and fetching", () => {
  it("hands outgoing messages to discord.js unchanged (allowedMentions intact)", async () => {
    const ch = thread();
    const message = msg({}, ch);
    const m = toQaMessage(message, ids, BOT)!;
    await m.target.reply(outgoing);
    await m.target.send(outgoing);
    expect((message.reply as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(outgoing);
    expect(ch.send.mock.calls[0]![0]).toBe(outgoing);
  });

  it("uses the member's server nickname, falling back to the account display name", () => {
    expect(toQaMessage(msg(), ids, BOT)!.author).toEqual({ id: OP, displayName: "Jane" });
    expect(toQaMessage(msg({ member: null }), ids, BOT)!.author.displayName).toBe("Jane G");
  });

  it("sendTyping goes to the channel; chat messages have no thread history", async () => {
    const ch = plainChannel();
    const m = toQaMessage(msg({}, ch), ids, BOT)!;
    await m.sendTyping();
    expect(ch.sendTyping).toHaveBeenCalled();
    expect(await m.fetchThreadMessages()).toEqual([]);
  });
});

describe("fetchThreadMessages", () => {
  const dm = (id: string, authorId: string, content: string, system = false) => [id, { id, author: { id: authorId }, content, system }] as const;

  it("returns oldest-first and maps the system flag", async () => {
    const ch = thread({ messages: { fetch: vi.fn(async () => new Map([dm("3", OP, "c"), dm("1", OP, "a"), dm("2", BOT, "b", true)])) } });
    const out = await fetchThreadMessages(ch as never);
    expect(out.map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(out[1]).toEqual({ id: "2", authorId: BOT, content: "b", system: true });
  });

  it("adds the starter message when it isn't in the latest 100", async () => {
    const starter = { id: "900", author: { id: OP }, content: "the question", system: false };
    const ch = thread({ messages: { fetch: vi.fn(async () => new Map([dm("1000", OP, "later")])) }, fetchStarterMessage: vi.fn(async () => starter) });
    const out = await fetchThreadMessages(ch as never);
    expect(out.map((m) => m.id)).toEqual(["900", "1000"]);
  });

  it("doesn't fetch the starter separately when it's already there", async () => {
    const ch = thread({ messages: { fetch: vi.fn(async () => new Map([dm("900", OP, "q")])) } });
    await fetchThreadMessages(ch as never);
    expect(ch.fetchStarterMessage).not.toHaveBeenCalled();
  });

  it("survives a starter that can't be fetched", async () => {
    const ch = thread({ messages: { fetch: vi.fn(async () => new Map([dm("1000", OP, "x")])) }, fetchStarterMessage: vi.fn(async () => Promise.reject(new Error("Unknown Message"))) });
    expect((await fetchThreadMessages(ch as never)).map((m) => m.id)).toEqual(["1000"]);
  });
});

describe("createFetchOldest (ref reader)", () => {
  it("asks Discord for the oldest 20 messages, returned oldest first", async () => {
    const fetch = vi.fn(async () => new Map([["3", { id: "3", author: { id: BOT }, content: "ours", system: false }], ["2", { id: "2", author: { id: BOT }, content: "", system: true }]]));
    const client = { channels: { fetch: vi.fn(async () => ({ isThread: () => true, messages: { fetch } })) } } as unknown as Client;
    const out = await createFetchOldest(client)("800");
    expect(fetch).toHaveBeenCalledWith({ after: "0", limit: 20 });
    expect(out).toEqual([
      { authorId: BOT, content: "", system: true },
      { authorId: BOT, content: "ours", system: false },
    ]);
  });

  it("returns nothing for a channel that isn't a thread", async () => {
    const client = { channels: { fetch: vi.fn(async () => ({ isThread: () => false })) } } as unknown as Client;
    expect(await createFetchOldest(client)("1")).toEqual([]);
    const gone = { channels: { fetch: vi.fn(async () => null) } } as unknown as Client;
    expect(await createFetchOldest(gone)("1")).toEqual([]);
  });
});

describe("loadStarter", () => {
  it("wraps the post's first message, or returns null if it can't be fetched", async () => {
    const starter = msg({ id: "900" });
    const t = thread({ fetchStarterMessage: vi.fn(async () => starter) });
    expect((await loadStarter(t as never, ids, BOT))?.id).toBe("900");
    const none = thread({ fetchStarterMessage: vi.fn(async () => Promise.reject(new Error("x"))) });
    expect(await loadStarter(none as never, ids, BOT)).toBeNull();
  });
});

describe("button adapters", () => {
  const interaction = (channel: unknown) => {
    const i = {
      customId: "qa:solved",
      user: { id: OP },
      member: { roles: [] },
      channel,
      deferUpdate: vi.fn(async () => {}),
      editReply: vi.fn(async () => {}),
      followUp: vi.fn(async () => {}),
      reply: vi.fn(async () => {}),
    };
    return i as unknown as ButtonInteraction & typeof i;
  };

  it.each([["answer", toAnswerButton], ["staff", toStaffButton]] as const)("%s: passes the thread through and calls interaction methods", async (_n, adapt) => {
    const t = thread();
    const i = interaction(t);
    const a = adapt(i);
    expect(a.customId).toBe("qa:solved");
    expect(a.channel).toBe(t);
    await a.deferUpdate();
    await a.editReply({ components: [] });
    expect(i.deferUpdate).toHaveBeenCalled();
    expect(i.editReply).toHaveBeenCalledWith({ components: [] });
  });

  it.each([["answer", toAnswerButton], ["staff", toStaffButton]] as const)("%s: a click outside a thread has no channel", (_n, adapt) => {
    expect(adapt(interaction(plainChannel())).channel).toBeNull();
    expect(adapt(interaction(null)).channel).toBeNull();
  });
});

describe("checkQaSetup", () => {
  const ALL_FORUM = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageThreads];
  const ALL_SUPPORT = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.ManageThreads];

  function world(o: { forum?: object | null; support?: object | null; role?: object | null; guild?: boolean; forumPerms?: bigint[]; supportPerms?: bigint[] } = {}) {
    const me = { permissions: new PermissionsBitField([]) };
    const forum =
      o.forum === null
        ? null
        : {
            type: ChannelType.GuildForum,
            availableTags: [{ id: "T_SUP" }, { id: "T_RES" }, { id: "T_STAFF" }],
            permissionsFor: () => new PermissionsBitField(o.forumPerms ?? ALL_FORUM),
            ...o.forum,
          };
    const support =
      o.support === null
        ? null
        : { type: ChannelType.GuildText, permissionsFor: () => new PermissionsBitField(o.supportPerms ?? ALL_SUPPORT), ...o.support };
    const role = o.role === null ? null : { mentionable: true, ...o.role };
    const guild = {
      members: { me, fetchMe: vi.fn() },
      roles: { fetch: vi.fn(async () => role) },
    };
    return {
      guilds: { fetch: vi.fn(async () => (o.guild === false ? Promise.reject(new Error("Unknown Guild")) : guild)) },
      channels: { fetch: vi.fn(async (id: string) => (id === FORUM ? forum : support)) },
    } as unknown as Client;
  }

  it("reports nothing when everything is in place", async () => {
    expect(await checkQaSetup(world(), ids)).toEqual([]);
  });

  it("requires the support role to be mentionable, whatever permissions the bot has", async () => {
    expect(await checkQaSetup(world({ role: { mentionable: false } }), ids)).toEqual(["support_role_not_mentionable"]);
    expect(await checkQaSetup(world({ role: { mentionable: true } }), ids)).toEqual([]);
  });

  it("flags tag IDs that aren't in the forum", async () => {
    const out = await checkQaSetup(world({ forum: { availableTags: [{ id: "T_SUP" }] } }), ids);
    expect(out).toEqual(["tag_resolved_not_in_forum", "tag_needs_staff_not_in_forum"]);
  });

  it("flags missing or wrong-typed channels and a missing role", async () => {
    expect(await checkQaSetup(world({ forum: null }), ids)).toContain("forum_not_found");
    expect(await checkQaSetup(world({ forum: { type: ChannelType.GuildText } }), ids)).toContain("forum_wrong_type");
    expect(await checkQaSetup(world({ support: null }), ids)).toContain("support_channel_not_found");
    expect(await checkQaSetup(world({ support: { type: ChannelType.GuildForum } }), ids)).toContain("support_channel_wrong_type");
    expect(await checkQaSetup(world({ role: null }), ids)).toContain("support_role_not_found");
  });

  it("flags each missing permission by name (no IDs)", async () => {
    const out = await checkQaSetup(world({ forumPerms: [PermissionFlagsBits.ViewChannel], supportPerms: [PermissionFlagsBits.ViewChannel] }), ids);
    expect(out).toEqual([
      "forum_missing_send_in_posts",
      "forum_missing_read_history",
      "forum_missing_manage_threads",
      "support_channel_missing_create_private_threads",
      "support_channel_missing_send_in_threads",
      "support_channel_missing_manage_threads",
    ]);
    for (const code of out) expect(code).not.toMatch(/\d{5,}/);
  });

  it("reports an unreachable guild", async () => {
    expect(await checkQaSetup(world({ guild: false }), ids)).toEqual(["guild_not_found"]);
  });
});
