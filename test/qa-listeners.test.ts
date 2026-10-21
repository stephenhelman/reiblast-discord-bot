import { EventEmitter } from "node:events";
import { Events, type ButtonInteraction, type Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { registerInteractionHandlers } from "../src/discord/interactions.js";
import { registerQaListeners } from "../src/discord/qa-listeners.js";
import type { QaIds } from "../src/discord/qa-adapter.js";
import type { QaHandler, QaMessage } from "../src/qa/handler.js";

const BOT = "100000000000000001";
const OP = "100000000000000002";
const GUILD = "111111111111111111";
const FORUM = "222222222222222221";
const ids: QaIds = {
  guildId: GUILD,
  forumId: FORUM,
  supportChannelId: "222222222222222222",
  staffRoleId: "333333333333333331",
  supportRoleId: "333333333333333332",
  tags: { tagSupportId: "T_SUP", tagResolvedId: "T_RES", tagNeedsStaffId: "T_STAFF" },
};
const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeClient(userId: string | null = BOT) {
  const emitter = new EventEmitter() as EventEmitter & { user?: { id: string } };
  emitter.user = userId ? { id: userId } : undefined;
  return emitter as unknown as Client & EventEmitter;
}

function handlerMock() {
  return {
    handleMessage: vi.fn(async (_m: QaMessage) => {}),
    handleTagAdded: vi.fn(async (_a: Parameters<QaHandler["handleTagAdded"]>[0]) => {}),
  } satisfies QaHandler;
}

const chatMessage = () => ({
  id: "m1",
  content: `<@${BOT}> hi`,
  partial: false,
  guildId: GUILD,
  inGuild: () => true,
  webhookId: null,
  system: false,
  author: { id: OP, bot: false, displayName: "Jane" },
  member: null,
  channel: { id: "c1", isThread: () => false, isSendable: () => true, send: vi.fn(), sendTyping: vi.fn() },
  reply: vi.fn(),
});

describe("MessageCreate listener", () => {
  it("hands each message to the orchestrator", async () => {
    const client = fakeClient();
    const handler = handlerMock();
    registerQaListeners(client, { ids, handler: () => handler });
    client.emit(Events.MessageCreate, chatMessage());
    await flush();
    expect(handler.handleMessage).toHaveBeenCalledTimes(1);
    expect(handler.handleMessage.mock.calls[0]![0]).toMatchObject({ id: "m1", facts: { mentionsBot: true } });
  });

  it("ignores messages before the bot user is known, and ones that can never be triggers", async () => {
    const early = fakeClient(null);
    const h1 = handlerMock();
    registerQaListeners(early, { ids, handler: () => h1 });
    early.emit(Events.MessageCreate, chatMessage());

    const client = fakeClient();
    const h2 = handlerMock();
    registerQaListeners(client, { ids, handler: () => h2 });
    client.emit(Events.MessageCreate, { ...chatMessage(), partial: true });
    await flush();
    expect(h1.handleMessage).not.toHaveBeenCalled();
    expect(h2.handleMessage).not.toHaveBeenCalled();
  });

  it("never lets an error escape the listener", async () => {
    const client = fakeClient();
    const handler = handlerMock();
    handler.handleMessage.mockRejectedValueOnce(new Error("boom"));
    registerQaListeners(client, { ids, handler: () => handler });
    expect(() => client.emit(Events.MessageCreate, chatMessage())).not.toThrow();
    await flush();
    // and keeps working afterwards
    client.emit(Events.MessageCreate, chatMessage());
    await flush();
    expect(handler.handleMessage).toHaveBeenCalledTimes(2);
  });
});

describe("ThreadUpdate listener", () => {
  const thread = (over: Record<string, unknown> = {}) => ({
    id: "900",
    guildId: GUILD,
    parentId: FORUM,
    appliedTags: [] as string[],
    ...over,
  });

  it("passes the tag change for a forum post to the orchestrator", async () => {
    const client = fakeClient();
    const handler = handlerMock();
    registerQaListeners(client, { ids, handler: () => handler });
    client.emit(Events.ThreadUpdate, thread(), thread({ appliedTags: ["T_SUP"] }));
    await flush();
    const args = handler.handleTagAdded.mock.calls[0]![0];
    expect(args).toMatchObject({ threadId: "900", change: { inForum: true, oldTags: [], newTags: ["T_SUP"] } });
    expect(typeof args.loadStarter).toBe("function");
  });

  it("marks threads outside the forum as not-in-forum, and ignores other guilds", async () => {
    const client = fakeClient();
    const handler = handlerMock();
    registerQaListeners(client, { ids, handler: () => handler });
    client.emit(Events.ThreadUpdate, thread({ parentId: "999999999999999999" }), thread({ parentId: "999999999999999999" }));
    client.emit(Events.ThreadUpdate, thread({ guildId: "999999999999999999" }), thread({ guildId: "999999999999999999" }));
    await flush();
    expect(handler.handleTagAdded).toHaveBeenCalledTimes(1);
    expect(handler.handleTagAdded.mock.calls[0]![0].change.inForum).toBe(false);
  });

  it("never lets an error escape", async () => {
    const client = fakeClient();
    const handler = handlerMock();
    handler.handleTagAdded.mockRejectedValueOnce(new Error("boom"));
    registerQaListeners(client, { ids, handler: () => handler });
    expect(() => client.emit(Events.ThreadUpdate, thread(), thread())).not.toThrow();
    await flush();
  });
});

describe("interaction routing", () => {
  function setup(qaAnswer: boolean, qaStaff: boolean) {
    const client = fakeClient();
    const flow = { handlePanelButton: vi.fn(async () => {}), handleEnterCodeButton: vi.fn(), handleAgreeButton: vi.fn(), handleIdentifierModal: vi.fn(), handleCodeModal: vi.fn() };
    const qa = { answer: vi.fn(async () => qaAnswer), staff: vi.fn(async () => qaStaff) };
    registerInteractionHandlers(client, { flow: flow as never, setup: vi.fn() as never, unlink: vi.fn() as never, qa });
    const click = (customId: string) =>
      client.emit(Events.InteractionCreate, { isChatInputCommand: () => false, isButton: () => true, isModalSubmit: () => false, customId } as unknown as ButtonInteraction);
    return { flow, qa, click };
  }

  it("lets the Q&A answer buttons handle their clicks, and stops there", async () => {
    const { flow, qa, click } = setup(true, false);
    click("qa:solved");
    await flush();
    expect(qa.answer).toHaveBeenCalledTimes(1);
    expect(qa.staff).not.toHaveBeenCalled();
    expect(flow.handlePanelButton).not.toHaveBeenCalled();
  });

  it("then tries the staff buttons", async () => {
    const { flow, qa, click } = setup(false, true);
    click("qa:close");
    await flush();
    expect(qa.answer).toHaveBeenCalled();
    expect(qa.staff).toHaveBeenCalled();
    expect(flow.handlePanelButton).not.toHaveBeenCalled();
  });

  it("leaves verify buttons to the verify flow", async () => {
    const { flow, click } = setup(false, false);
    click("verify:email");
    await flush();
    expect(flow.handlePanelButton).toHaveBeenCalledWith(expect.anything(), "email");
  });
});
