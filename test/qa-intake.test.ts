import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../src/logger.js";
import type { AnswerInput, AnswerResult, Answerer } from "../src/qa/answer.js";
import type { ThreadLike } from "../src/qa/buttons.js";
import type { ThreadMessage } from "../src/qa/history.js";
import { countDiagnoseTurns, createIntake, createSummarizer, type Summarizer } from "../src/qa/intake.js";
import { MAX_DIAGNOSE } from "../src/qa/progress.js";
import { createThreadStateStore } from "../src/qa/state.js";

const BOT = "100000000000000001";
const OP = "100000000000000002";
const POST = "900000000000000010";
const SECRET = "SECRET-MEMBER-WORDS";

const bot = (id: string, content: string): ThreadMessage => ({ id, authorId: BOT, content });
const op = (id: string, content: string): ThreadMessage => ({ id, authorId: OP, content });
const thread = (): ThreadLike =>
  ({ id: POST, name: "Texts not sending", url: "https://discord.com/channels/1/900", ownerId: OP, appliedTags: [], setAppliedTags: vi.fn(), send: vi.fn() }) as unknown as ThreadLike;

/** A thread where the bot asked two diagnose questions. */
const troubleshooting = (): ThreadMessage[] => [
  op(POST, "my texts aren't sending"),
  bot("b1", "Banner color?\n-# Check 1 of 4"),
  op("o1", "green"),
  bot("b2", "Wallet balance above zero?\n-# Check 2 of 4"),
  op("o2", "I don't know how to check"),
];
const plain = (): ThreadMessage[] => [op(POST, "how do I import leads?"), bot("b1", "Go to Contacts.")];

function setup(over: { fetch?: () => Promise<ThreadMessage[]>; summarize?: Summarizer } = {}) {
  const logs: string[] = [];
  const logger = {
    debug() {},
    info() {},
    warn: (m: string, f?: object) => logs.push(m + JSON.stringify(f ?? {})),
    error: (m: string, f?: object) => logs.push(m + JSON.stringify(f ?? {})),
  } as Logger;
  const state = createThreadStateStore();
  const fetchMessages = vi.fn(over.fetch ?? (async () => troubleshooting()));
  const summarize = vi.fn(over.summarize ?? (async () => ({ ok: true as const, summary: "REGENERATED summary." })));
  const intake = createIntake({ state, summarize, botId: BOT, fetchMessages, logger });
  return { intake, state, fetchMessages, summarize, logs };
}

describe("countDiagnoseTurns", () => {
  it("counts the bot's diagnose markers only", () => {
    expect(countDiagnoseTurns(troubleshooting(), BOT)).toBe(2);
    expect(countDiagnoseTurns(plain(), BOT)).toBe(0);
    expect(countDiagnoseTurns([op("x", "Q?\n-# Check 1 of 4"), { ...bot("s", "Q?\n-# Check 1 of 4"), system: true }, bot("c", "Q?\n-# Quick question")], BOT)).toBe(0);
  });
});

describe("contextFor: is this a troubleshooting thread?", () => {
  it("a thread with no diagnose question gets nothing extra, and costs no fetch or model call when the count is known", async () => {
    const t = setup();
    expect(await t.intake.contextFor(thread(), { diagnoseTurns: 0 })).toEqual({ troubleshooting: false });
    expect(t.fetchMessages).not.toHaveBeenCalled();
    expect(t.summarize).not.toHaveBeenCalled();
  });

  it("derives the answer from the thread when the caller doesn't know (a button click)", async () => {
    const plainThread = setup({ fetch: async () => plain() });
    expect(await plainThread.intake.contextFor(thread())).toEqual({ troubleshooting: false });
    expect(plainThread.fetchMessages).toHaveBeenCalledTimes(1);

    const t = setup();
    t.state.setSummary(POST, "Remembered summary.");
    expect(await t.intake.contextFor(thread())).toEqual({ troubleshooting: true, summary: "Remembered summary." });
  });

  it("uses messages the caller already fetched instead of fetching again", async () => {
    const t = setup();
    t.state.setSummary(POST, "S");
    await t.intake.contextFor(thread(), { messages: troubleshooting() });
    expect(t.fetchMessages).not.toHaveBeenCalled();
  });

  it("if the thread can't be read, it plays safe: no summary or intake ask, a code is logged", async () => {
    const t = setup({ fetch: async () => Promise.reject(new Error(`Missing Access ${SECRET}`)) });
    expect(await t.intake.contextFor(thread())).toEqual({ troubleshooting: false });
    expect(t.logs.join()).toContain("intake_fetch_failed");
    expect(t.logs.join()).not.toContain(SECRET);
  });
});

describe("contextFor: where the summary comes from", () => {
  it("prefers the summary from the model call that just happened", async () => {
    const t = setup();
    t.state.setSummary(POST, "Older remembered summary.");
    expect(await t.intake.contextFor(thread(), { diagnoseTurns: 2, summary: "  Fresh summary.  " })).toEqual({ troubleshooting: true, summary: "Fresh summary." });
    expect(t.summarize).not.toHaveBeenCalled();
  });

  it("then the one remembered in memory", async () => {
    const t = setup();
    t.state.setSummary(POST, "Remembered summary.");
    expect(await t.intake.contextFor(thread(), { diagnoseTurns: 2, summary: "" })).toEqual({ troubleshooting: true, summary: "Remembered summary." });
    expect(t.summarize).not.toHaveBeenCalled();
  });

  it("after a restart (nothing remembered): one extra model call, built from the thread's history and ending on the member's last words", async () => {
    const t = setup();
    const result = await t.intake.contextFor(thread(), { messages: troubleshooting(), diagnoseTurns: 2 });
    expect(result).toEqual({ troubleshooting: true, summary: "REGENERATED summary." });
    expect(t.summarize).toHaveBeenCalledTimes(1);
    const turns = t.summarize.mock.calls[0]![0];
    expect(turns.at(-1)).toEqual({ role: "user", text: "I don't know how to check" });
    expect(turns[0]).toEqual({ role: "user", text: "Title: Texts not sending\n\nmy texts aren't sending" });
    expect(JSON.stringify(turns)).not.toContain("-#"); // markers never reach the model
  });

  it("if that call fails, proceeds without a summary and logs the code only", async () => {
    for (const summarize of [async () => ({ ok: false as const }), async () => Promise.reject(new Error(SECRET))]) {
      const t = setup({ summarize });
      expect(await t.intake.contextFor(thread(), { messages: troubleshooting(), diagnoseTurns: 2 })).toEqual({ troubleshooting: true });
      expect(t.logs.join()).toContain("summary_unavailable");
      expect(t.logs.join()).not.toContain(SECRET);
    }
  });

  it("when the model is failing, doesn't spend another call: no summary, same code", async () => {
    const t = setup();
    expect(await t.intake.contextFor(thread(), { messages: troubleshooting(), diagnoseTurns: 2, allowRegenerate: false })).toEqual({ troubleshooting: true });
    expect(t.summarize).not.toHaveBeenCalled();
    expect(t.logs.join()).toContain("summary_unavailable");
  });

  it("can't rebuild a summary if the poster never wrote anything", async () => {
    const t = setup();
    const onlyBot = [bot("b1", "Q?\n-# Check 1 of 4")];
    expect(await t.intake.contextFor(thread(), { messages: onlyBot, diagnoseTurns: 1 })).toEqual({ troubleshooting: true });
    expect(t.summarize).not.toHaveBeenCalled();
  });
});

describe("createSummarizer", () => {
  const okResult = (over: object = {}): AnswerResult => ({ ok: true, outcome: "not_covered", summary: "Member says texts fail.", ...over }) as AnswerResult;
  function build(result: AnswerResult) {
    const answer = vi.fn(async (_i: AnswerInput) => result);
    return { answer, summarize: createSummarizer(answer as unknown as Answerer) };
  }

  it("goes through the normal answerer with every question cap already reached, so it can't ask anything", async () => {
    const t = build(okResult());
    await t.summarize([{ role: "user", text: "texts fail" }]);
    expect(t.answer).toHaveBeenCalledWith({
      history: [{ role: "user", text: "texts fail" }],
      surface: "forum",
      progress: { diagnoseAsked: MAX_DIAGNOSE, clarifyUsed: true },
    });
  });

  it("takes the summary whatever outcome the model picked (the reply is discarded)", async () => {
    for (const outcome of ["not_covered", "account_specific", "answered", "diagnose", "clarify"]) {
      const t = build(okResult({ outcome, reply: "ignored", kbIds: ["x"] }));
      expect(await t.summarize([{ role: "user", text: "x" }])).toEqual({ ok: true, summary: "Member says texts fail." });
    }
  });

  it("drops trailing bot turns, so the history ends on the member", async () => {
    const t = build(okResult());
    await t.summarize([{ role: "user", text: "texts fail" }, { role: "assistant", text: "Banner color?" }]);
    expect(t.answer.mock.calls[0]![0].history).toEqual([{ role: "user", text: "texts fail" }]);
  });

  it("fails cleanly on a model failure, an empty summary, or no member turns", async () => {
    expect(await build({ ok: false, reason: "timeout" }).summarize([{ role: "user", text: "x" }])).toEqual({ ok: false });
    expect(await build(okResult({ summary: "" })).summarize([{ role: "user", text: "x" }])).toEqual({ ok: false });
    const none = build(okResult());
    expect(await none.summarize([{ role: "assistant", text: "hi" }])).toEqual({ ok: false });
    expect(none.answer).not.toHaveBeenCalled();
  });
});
