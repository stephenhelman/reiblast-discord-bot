import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../src/logger.js";
import type { Answerer, AnswerResult } from "../src/qa/answer.js";
import type { ThreadLike } from "../src/qa/buttons.js";
import { createQaHandler, type QaMessage } from "../src/qa/handler.js";
import type { ThreadMessage } from "../src/qa/history.js";
import { createCoalescer, createRateLimiter } from "../src/qa/limits.js";
import { QA_TEXT } from "../src/qa/messages.js";
import type { OutgoingMessage } from "../src/qa/post.js";
import { createThreadStateStore } from "../src/qa/state.js";
import { MAX_BOT_TURNS, type MessageFacts, type TagChange, type Where } from "../src/qa/triggers.js";

const BOT = "100000000000000001";
const OP = "100000000000000002";
const OTHER = "100000000000000003";
const POST = "900000000000000010";
const tags = { tagSupportId: "T_SUP", tagResolvedId: "T_RES", tagNeedsStaffId: "T_STAFF" };
const SECRET = "SECRET-MEMBER-TEXT";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

interface Posted {
  kind: "reply" | "send";
  msg: OutgoingMessage;
}

function setup(over: { answers?: AnswerResult[]; limiter?: { max: number }; answerImpl?: Answerer } = {}) {
  const queue = [...(over.answers ?? [])];
  const answer = vi.fn(over.answerImpl ?? (async () => queue.shift() ?? ({ ok: true, outcome: "not_covered", summary: "S" } as AnswerResult)));
  const escalator = { handoff: vi.fn(async () => {}), accountSpecific: vi.fn(async () => {}) };
  const alert = vi.fn();
  const state = createThreadStateStore();
  const logs: string[] = [];
  const logger = {
    debug: (m: string, f?: object) => logs.push(m + JSON.stringify(f ?? {})),
    info: (m: string, f?: object) => logs.push(m + JSON.stringify(f ?? {})),
    warn: (m: string, f?: object) => logs.push(m + JSON.stringify(f ?? {})),
    error: (m: string, f?: object) => logs.push(m + JSON.stringify(f ?? {})),
  } as Logger;
  const handler = createQaHandler({
    botId: BOT,
    tags,
    answer: answer as unknown as Answerer,
    limiter: createRateLimiter({ max: over.limiter?.max ?? 100 }),
    state,
    coalesce: createCoalescer(),
    escalator,
    alert,
    logger,
  });
  return { handler, answer, escalator, alert, state, logs };
}

interface MsgOpts {
  id?: string;
  content?: string;
  authorId?: string;
  where?: Where;
  facts?: Partial<MessageFacts>;
  threadMessages?: ThreadMessage[];
  title?: string;
  isThread?: boolean;
  postFails?: boolean;
}

function forumWhere(over: Partial<{ ownerId: string; appliedTags: string[]; isStarter: boolean }> = {}): Where {
  return { kind: "forum-thread", ownerId: OP, appliedTags: [tags.tagSupportId], isStarter: false, ...over };
}

function message(o: MsgOpts = {}) {
  const posted: Posted[] = [];
  const where = o.where ?? forumWhere();
  const thread: ThreadLike | null =
    where.kind === "forum-thread"
      ? ({ id: POST, url: "https://discord.com/channels/1/900", ownerId: OP, appliedTags: where.appliedTags, setAppliedTags: vi.fn(), send: vi.fn() } as unknown as ThreadLike)
      : null;
  const record = (kind: Posted["kind"]) => async (msg: OutgoingMessage) => {
    if (o.postFails) throw new Error("Missing Permissions");
    posted.push({ kind, msg });
  };
  const authorId = o.authorId ?? OP;
  const m: QaMessage = {
    id: o.id ?? "m1",
    content: o.content ?? SECRET,
    author: { id: authorId, displayName: "Jane" },
    facts: {
      inGuild: true,
      authorId,
      authorIsBot: false,
      authorIsStaff: false,
      mentionsBot: false,
      hasText: true,
      where,
      ...o.facts,
    },
    thread,
    title: o.title ?? "Texts not sending",
    channelId: "c1",
    target: { reply: record("reply"), send: record("send") },
    fetchThreadMessages: vi.fn(async () => o.threadMessages ?? []),
    sendTyping: vi.fn(async () => {}),
  };
  return { m, posted };
}

const starterMsgs = (content = SECRET): ThreadMessage[] => [{ id: POST, authorId: OP, content }];
const answered = (reply = "Go to Billing."): AnswerResult => ({ ok: true, outcome: "answered", reply, kbIds: ["wal-001"], summary: "S" });

describe("forum: new posts", () => {
  const newPost = (over: MsgOpts = {}) =>
    message({ id: POST, where: forumWhere({ isStarter: true }), threadMessages: starterMsgs(), ...over });

  it("answers a new Support post with the answer and the two buttons, as a reply", async () => {
    const t = setup({ answers: [answered()] });
    const { m, posted } = newPost();
    await t.handler.handleMessage(m);

    expect(t.answer).toHaveBeenCalledTimes(1);
    expect(t.answer.mock.calls[0]![0]).toMatchObject({
      surface: "forum",
      progress: { diagnoseAsked: 0, clarifyUsed: false },
      history: [{ role: "user", text: `Title: Texts not sending\n\n${SECRET}` }],
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.kind).toBe("reply");
    expect(posted[0]!.msg.content).toBe("Go to Billing.");
    expect(posted[0]!.msg.allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(posted[0]!.msg.components?.[0]?.toJSON().components).toMatchObject([{ custom_id: "qa:solved" }, { custom_id: "qa:help" }]);
    expect(t.state.get(POST)).toEqual({ botTurns: 1, last: "answered" });
    expect(t.escalator.handoff).not.toHaveBeenCalled();
  });

  it("shows the typing indicator while the model works", async () => {
    const t = setup({ answers: [answered()] });
    const { m } = newPost();
    await t.handler.handleMessage(m);
    expect(m.sendTyping).toHaveBeenCalled();
  });

  it("a clarifying question has no buttons, and the next OP message is told a clarify just happened", async () => {
    const t = setup({ answers: [{ ok: true, outcome: "clarify", reply: "Which error?", summary: "S" }, answered()] });
    const first = newPost();
    await t.handler.handleMessage(first.m);
    expect(first.posted[0]!.msg.components).toBeUndefined();
    expect(t.state.priorClarify(POST)).toBe(true);

    const second = message({ id: "m2", threadMessages: [...starterMsgs(), { id: "b1", authorId: BOT, content: "Which error?" }] });
    await t.handler.handleMessage(second.m);
    expect(t.answer.mock.calls[1]![0].progress?.clarifyUsed).toBe(true);
  });

  it("not_covered → handoff to staff; the handler itself posts nothing", async () => {
    const t = setup({ answers: [{ ok: true, outcome: "not_covered", summary: "S" }] });
    const { m, posted } = newPost();
    await t.handler.handleMessage(m);
    expect(t.escalator.handoff).toHaveBeenCalledWith(m.thread, "not_covered");
    expect(posted).toEqual([]);
  });

  it("account_specific → private-thread escalation with the asker and their question", async () => {
    const t = setup({ answers: [{ ok: true, outcome: "account_specific", summary: "S" }] });
    const { m, posted } = newPost();
    await t.handler.handleMessage(m);
    expect(t.escalator.accountSpecific).toHaveBeenCalledWith(m.thread, { id: OP, displayName: "Jane" }, `Title: Texts not sending\n\n${SECRET}`);
    expect(t.escalator.handoff).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it.each(["timeout", "api_error", "refusal", "max_tokens", "bad_output"] as const)("a model failure (%s) is handled like not_covered and never posts model text", async (reason) => {
    const t = setup({ answers: [{ ok: false, reason }] });
    const { m, posted } = newPost();
    await t.handler.handleMessage(m);
    expect(t.escalator.handoff).toHaveBeenCalledWith(m.thread, `qa_${reason}`);
    expect(posted).toEqual([]);
  });

  it("if posting the answer fails: alerts staff, doesn't throw, doesn't count a bot turn", async () => {
    const t = setup({ answers: [answered()] });
    const { m } = newPost({ postFails: true });
    await expect(t.handler.handleMessage(m)).resolves.toBeUndefined();
    expect(t.alert).toHaveBeenCalledWith("qa_post_failed");
    expect(t.state.get(POST)?.botTurns).toBe(0);
  });
});

describe("forum: follow-ups and silence", () => {
  const convo: ThreadMessage[] = [
    { id: POST, authorId: OP, content: "my texts won't send" },
    { id: "s1", authorId: "100000000000000099", content: "staff chatter" },
    { id: "b1", authorId: BOT, content: "Check A2P." },
    { id: "o2", authorId: OTHER, content: "me too" },
    { id: "f1", authorId: OP, content: "ok, what about the wallet?" },
  ];

  it("answers an OP follow-up using only the OP's and the bot's messages, newest last", async () => {
    const t = setup({ answers: [answered()] });
    t.state.recordPost(POST, "answered");
    const { m } = message({ id: "f1", content: "ok, what about the wallet?", threadMessages: convo });
    await t.handler.handleMessage(m);
    expect(t.answer.mock.calls[0]![0].history).toEqual([
      { role: "user", text: "Title: Texts not sending\n\nmy texts won't send" },
      { role: "assistant", text: "Check A2P." },
      { role: "user", text: "ok, what about the wallet?" },
    ]);
  });

  it.each([
    ["another member without a mention", { authorId: OTHER }],
    ["a bot", { authorId: "100000000000000050", facts: { authorIsBot: true } }],
    ["staff replying in the OP's post", { facts: { authorIsStaff: true } }],
    ["a Resolved post", { where: forumWhere({ appliedTags: [tags.tagSupportId, tags.tagResolvedId] }) }],
    ["a Needs Staff post", { where: forumWhere({ appliedTags: [tags.tagNeedsStaffId] }) }],
    ["a non-Support Chat-style post with no mention", { where: { kind: "other" } as Where }],
  ] as const)("stays silent for %s", async (_n, opts) => {
    const t = setup({ answers: [answered()] });
    t.state.recordPost(POST, "answered");
    const { m, posted } = message(opts as MsgOpts);
    await t.handler.handleMessage(m);
    expect(t.answer).not.toHaveBeenCalled();
    expect(t.escalator.handoff).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it("another member's @mention in an answered post is ignored", async () => {
    const t = setup({ answers: [answered()] });
    t.state.recordPost(POST, "answered");
    const { m } = message({ authorId: OTHER, facts: { mentionsBot: true } });
    await t.handler.handleMessage(m);
    expect(t.answer).not.toHaveBeenCalled();
  });

  it("another member's @mention in an unanswered post is answered, with the OP's post as context", async () => {
    const t = setup({ answers: [answered()] });
    t.state.seed(POST, 0);
    const { m, posted } = message({
      id: "m9",
      authorId: OTHER,
      content: `<@${BOT}> can you help here?`,
      facts: { mentionsBot: true },
      threadMessages: starterMsgs("my texts won't send"),
    });
    await t.handler.handleMessage(m);
    expect(t.answer.mock.calls[0]![0].history).toEqual([
      { role: "user", text: "Title: Texts not sending\n\nmy texts won't send" },
      { role: "user", text: "can you help here?" },
    ]);
    expect(posted).toHaveLength(1);
  });

  it("escalates (like not_covered) once the bot has used its turns", async () => {
    const t = setup();
    t.state.seed(POST, MAX_BOT_TURNS);
    const { m } = message();
    await t.handler.handleMessage(m);
    expect(t.escalator.handoff).toHaveBeenCalledWith(m.thread, "turn_cap");
    expect(t.answer).not.toHaveBeenCalled();
  });
});

describe("after a restart (bot turn count unknown)", () => {
  const withBotTurns = (n: number): ThreadMessage[] => [
    ...starterMsgs("hello"),
    ...Array.from({ length: n }, (_, i) => ({ id: `b${i}`, authorId: BOT, content: `a${i}` })),
  ];

  it("re-counts the bot's posts from the thread, then answers the follow-up", async () => {
    const t = setup({ answers: [answered()] });
    const { m } = message({ id: "f9", threadMessages: withBotTurns(1) });
    await t.handler.handleMessage(m);
    expect(m.fetchThreadMessages).toHaveBeenCalled();
    expect(t.answer).toHaveBeenCalledTimes(1);
    expect(t.state.get(POST)?.botTurns).toBeGreaterThanOrEqual(1);
  });

  it("stays silent if the bot never answered this post", async () => {
    const t = setup({ answers: [answered()] });
    const { m } = message({ id: "f9", threadMessages: withBotTurns(0) });
    await t.handler.handleMessage(m);
    expect(t.answer).not.toHaveBeenCalled();
  });

  it("escalates a thread that already used its turns before the restart", async () => {
    const t = setup();
    const { m } = message({ id: "f9", threadMessages: withBotTurns(MAX_BOT_TURNS) });
    await t.handler.handleMessage(m);
    expect(t.escalator.handoff).toHaveBeenCalledWith(m.thread, "turn_cap");
  });

  it("doesn't fetch the thread at all for messages that can't be triggers", async () => {
    const t = setup();
    const { m } = message({ authorId: OTHER });
    await t.handler.handleMessage(m);
    expect(m.fetchThreadMessages).not.toHaveBeenCalled();
  });
});

describe("Support tag added later", () => {
  const change = (over: Partial<TagChange> = {}): TagChange => ({ inForum: true, oldTags: [], newTags: [tags.tagSupportId], ...over });
  const starter = () => message({ id: POST, where: forumWhere({ isStarter: true }), threadMessages: starterMsgs("question"), authorId: OP });

  it("answers the post's first message", async () => {
    const t = setup({ answers: [answered()] });
    const s = starter();
    const loadStarter = vi.fn(async () => s.m);
    await t.handler.handleTagAdded({ threadId: POST, change: change(), loadStarter });
    expect(loadStarter).toHaveBeenCalledTimes(1);
    expect(t.answer).toHaveBeenCalledTimes(1);
    expect(s.posted).toHaveLength(1);
  });

  it("doesn't even load the post when the update can't be a trigger", async () => {
    const t = setup();
    const loadStarter = vi.fn(async () => starter().m);
    await t.handler.handleTagAdded({ threadId: POST, change: change({ oldTags: [tags.tagSupportId] }), loadStarter });
    await t.handler.handleTagAdded({ threadId: POST, change: change({ inForum: false }), loadStarter });
    await t.handler.handleTagAdded({ threadId: POST, change: change({ newTags: [tags.tagSupportId, tags.tagNeedsStaffId] }), loadStarter });
    expect(loadStarter).not.toHaveBeenCalled();
  });

  it("skips a post the bot already answered (known), and one it answered before a restart (counted)", async () => {
    const known = setup({ answers: [answered()] });
    known.state.recordPost(POST, "answered");
    const load = vi.fn(async () => starter().m);
    await known.handler.handleTagAdded({ threadId: POST, change: change(), loadStarter: load });
    expect(load).not.toHaveBeenCalled();

    const restart = setup({ answers: [answered()] });
    const s = message({ id: POST, where: forumWhere({ isStarter: true }), threadMessages: [...starterMsgs(), { id: "b1", authorId: BOT, content: "earlier answer" }] });
    await restart.handler.handleTagAdded({ threadId: POST, change: change(), loadStarter: async () => s.m });
    expect(restart.answer).not.toHaveBeenCalled();
  });

  it("does nothing if the first message can't be loaded", async () => {
    const t = setup();
    await t.handler.handleTagAdded({ threadId: POST, change: change(), loadStarter: async () => null });
    expect(t.answer).not.toHaveBeenCalled();
  });
});

describe("chat and other channels", () => {
  const chat = (over: MsgOpts = {}) => message({ where: { kind: "other" }, content: `<@${BOT}> how do I import leads?`, facts: { mentionsBot: true }, ...over });

  it("answers an @mention briefly in place: a reply with no buttons, history is just that message", async () => {
    const t = setup({ answers: [answered("Use Contacts → Import.")] });
    const { m, posted } = chat();
    await t.handler.handleMessage(m);
    expect(t.answer.mock.calls[0]![0]).toMatchObject({ surface: "chat", history: [{ role: "user", text: "how do I import leads?" }] });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.msg.components).toBeUndefined();
    expect(posted[0]!.msg.allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(m.fetchThreadMessages).not.toHaveBeenCalled();
  });

  it("is silent without a mention", async () => {
    const t = setup();
    const { m, posted } = chat({ facts: { mentionsBot: false } });
    await t.handler.handleMessage(m);
    expect(t.answer).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it.each([
    ["not_covered", { ok: true, outcome: "not_covered", summary: "S" }],
    ["account_specific", { ok: true, outcome: "account_specific", summary: "S" }],
  ] as const)("%s → the fixed forum pointer, no escalation", async (_n, result) => {
    const t = setup({ answers: [result as AnswerResult] });
    const { m, posted } = chat();
    await t.handler.handleMessage(m);
    expect(posted.map((p) => p.msg.content)).toEqual([QA_TEXT.chatPointer]);
    expect(t.escalator.handoff).not.toHaveBeenCalled();
    expect(t.escalator.accountSpecific).not.toHaveBeenCalled();
  });

  it("a model failure posts only the fixed pointer, and still alerts staff (reason only)", async () => {
    const t = setup({ answers: [{ ok: false, reason: "timeout" }] });
    const { m, posted } = chat();
    await t.handler.handleMessage(m);
    expect(posted.map((p) => p.msg.content)).toEqual([QA_TEXT.chatPointer]);
    expect(t.alert).toHaveBeenCalledWith("qa_timeout");
    expect(t.escalator.handoff).not.toHaveBeenCalled();
  });

  it("is silent in the Support channel even when mentioned", async () => {
    const t = setup();
    const { m, posted } = chat({ where: { kind: "support-channel" } });
    await t.handler.handleMessage(m);
    expect(t.answer).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});

describe("rate limit", () => {
  it("in the forum: after the limit, one polite note, then silence; no model calls", async () => {
    const t = setup({ limiter: { max: 1 }, answers: [answered()] });
    const first = message({ id: "a" });
    t.state.seed(POST, 1);
    await t.handler.handleMessage(first.m);
    const second = message({ id: "b" });
    const third = message({ id: "c" });
    await t.handler.handleMessage(second.m);
    await t.handler.handleMessage(third.m);

    expect(t.answer).toHaveBeenCalledTimes(1);
    expect(second.posted.map((p) => p.msg.content)).toEqual([QA_TEXT.rateLimited]);
    expect(third.posted).toEqual([]);
  });

  it("in chat: silent", async () => {
    const t = setup({ limiter: { max: 1 }, answers: [answered()] });
    const mk = (id: string) => message({ id, where: { kind: "other" }, facts: { mentionsBot: true }, content: `<@${BOT}> hi` });
    await t.handler.handleMessage(mk("a").m);
    const limited = mk("b");
    await t.handler.handleMessage(limited.m);
    expect(t.answer).toHaveBeenCalledTimes(1);
    expect(limited.posted).toEqual([]);
  });

  it("limits per user", async () => {
    const t = setup({ limiter: { max: 1 }, answers: [answered(), answered()] });
    t.state.seed(POST, 1);
    await t.handler.handleMessage(message({ id: "a", authorId: OP }).m);
    t.state.seed("other-post", 0);
    const other = message({ id: "b", authorId: OTHER, facts: { mentionsBot: true }, where: { kind: "other" } });
    await t.handler.handleMessage(other.m);
    expect(t.answer).toHaveBeenCalledTimes(2);
  });
});

describe("coalescing", () => {
  it("messages that arrive while an answer is running become one follow-up run on the latest message", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const t = setup({
      answerImpl: (async () => {
        if (++calls === 1) await gate;
        return answered(`answer ${calls}`);
      }) as unknown as Answerer,
    });
    t.state.seed(POST, 1);
    const mk = (id: string, content: string) => message({ id, content, threadMessages: [...starterMsgs("q"), { id: "b1", authorId: BOT, content: "a" }, { id, authorId: OP, content }] });

    const m1 = mk("m1", "first");
    const p1 = t.handler.handleMessage(m1.m);
    await tick();
    const m2 = mk("m2", "second");
    const m3 = mk("m3", "third");
    const p2 = t.handler.handleMessage(m2.m);
    const p3 = t.handler.handleMessage(m3.m);
    release();
    await Promise.all([p1, p2, p3]);

    expect(t.answer).toHaveBeenCalledTimes(2);
    expect(t.answer.mock.calls[1]![0].history.at(-1)).toEqual({ role: "user", text: "third" });
    expect(m1.posted).toHaveLength(1);
    expect(m2.posted).toHaveLength(0);
    expect(m3.posted).toHaveLength(1);
  });
});

describe("logging", () => {
  it("logs codes and counts only: never message text, names or IDs", async () => {
    const t = setup({ answers: [answered(`REPLY-${SECRET}`), { ok: true, outcome: "account_specific", summary: "S" }, { ok: false, reason: "timeout" }] });
    t.state.seed(POST, 1);
    for (const id of ["a", "b", "c"]) await t.handler.handleMessage(message({ id, content: SECRET }).m);
    await t.handler.handleMessage(message({ authorId: OTHER, content: SECRET }).m);
    const dump = t.logs.join("\n");
    for (const secret of [SECRET, "Jane", OP, OTHER, BOT, POST, "discord.com"]) expect(dump).not.toContain(secret);
    expect(dump).toContain("handled");
  });
});
