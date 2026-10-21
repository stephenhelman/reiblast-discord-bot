import { describe, expect, it } from "vitest";
import { buildThreadHistory, buildSingleTurn, cleanContent, type HistoryContext, type ThreadMessage } from "../src/qa/history.js";
import { buildMessages } from "../src/qa/prompt.js";
import { QA_TEXT } from "../src/qa/messages.js";

const BOT = "100000000000000001";
const OP = "100000000000000002";
const STAFF = "100000000000000003";
const OTHER = "100000000000000004";
const THREAD = "900";

const m = (id: string, authorId: string, content: string, system = false): ThreadMessage => ({ id, authorId, content, system });

function ctx(trigger: ThreadMessage, over: Partial<HistoryContext> = {}): HistoryContext {
  return { botId: BOT, opId: OP, threadId: THREAD, title: "Texts not sending", trigger, ...over };
}

describe("cleanContent", () => {
  it("removes the bot mention and neutralizes other mentions", () => {
    expect(cleanContent(`<@${BOT}> hi <@!${BOT}> there <@${STAFF}> <@&555555555555555555>`, BOT)).toBe("hi  there [mention] [role mention]");
  });
  it("trims and collapses blank-line runs", () => {
    expect(cleanContent("  a  \n\n\n\n b \n", BOT)).toBe("a\n\n b");
  });
  it("keeps no raw user or role IDs", () => {
    expect(cleanContent(`<@${STAFF}> <@&${OTHER}>`, BOT)).not.toMatch(/\d{10,}/);
  });
});

describe("buildThreadHistory", () => {
  it("keeps only the poster's and the bot's messages, in order, ending with the trigger", () => {
    const trigger = m("5", OP, "ok thanks, one more thing");
    const { turns, botTurns } = buildThreadHistory(
      [
        m(THREAD, OP, "my texts won't send"),
        m("1", STAFF, "staff chatter"),
        m("2", BOT, "Check your A2P and wallet."),
        m("3", OTHER, "same here"),
        m("4", "100000000000000009", "another bot's message"),
        m("sys", OP, "pinned a message", true),
        trigger,
      ],
      ctx(trigger),
    );
    expect(turns).toEqual([
      { role: "user", text: "Title: Texts not sending\n\nmy texts won't send" },
      { role: "assistant", text: "Check your A2P and wallet." },
      { role: "user", text: "ok thanks, one more thing" },
    ]);
    expect(botTurns).toBe(1);
  });

  it("puts the trigger last even if it appears mid-list or is written by someone else", () => {
    const trigger = m("2", OTHER, `<@${BOT}> can you help here?`);
    const { turns } = buildThreadHistory([m(THREAD, OP, "question"), trigger, m("3", OP, "later message")], ctx(trigger));
    expect(turns.map((t) => t.text)).toEqual(["Title: Texts not sending\n\nquestion", "later message", "can you help here?"]);
    expect(turns.at(-1)?.role).toBe("user");
  });

  it("adds the title to the starter message even when the starter is the trigger", () => {
    const trigger = m(THREAD, OP, "details here");
    expect(buildThreadHistory([trigger], ctx(trigger)).turns).toEqual([{ role: "user", text: "Title: Texts not sending\n\ndetails here" }]);
    const empty = m(THREAD, OP, "");
    expect(buildThreadHistory([empty], ctx(empty)).turns).toEqual([{ role: "user", text: "Title: Texts not sending" }]);
  });

  it("does not put the title on later messages, and works with no title", () => {
    const trigger = m("2", OP, "follow-up");
    const { turns } = buildThreadHistory([m(THREAD, OP, "first"), trigger], ctx(trigger, { title: undefined }));
    expect(turns.map((t) => t.text)).toEqual(["first", "follow-up"]);
  });

  it("counts every bot message (even button-only ones) but only sends the ones with text", () => {
    const trigger = m("9", OP, "again");
    const { turns, botTurns } = buildThreadHistory(
      [m(THREAD, OP, "q"), m("1", BOT, "answer one"), m("2", BOT, ""), m("3", BOT, "answer two"), trigger],
      ctx(trigger),
    );
    expect(botTurns).toBe(3);
    expect(turns.filter((t) => t.role === "assistant").map((t) => t.text)).toEqual(["answer one", "answer two"]);
  });

  it("does not count the trigger or system messages as bot turns", () => {
    const trigger = m("2", BOT, "bot as trigger?");
    expect(buildThreadHistory([m("1", BOT, "x", true), trigger], ctx(trigger)).botTurns).toBe(0);
  });

  it("strips the bot mention and other mentions from every turn", () => {
    const trigger = m("2", OP, `<@${BOT}> ask <@${STAFF}>`);
    const { turns } = buildThreadHistory([m(THREAD, OP, `<@${BOT}> help`), trigger], ctx(trigger));
    expect(JSON.stringify(turns)).not.toMatch(/\d{10,}/);
    expect(turns.at(-1)?.text).toBe("ask [mention]");
  });

  it("drops messages that are empty after cleaning", () => {
    const trigger = m("3", OP, "real question");
    const { turns } = buildThreadHistory([m(THREAD, OP, ""), m("1", OP, `<@${BOT}>`), trigger], ctx(trigger, { title: undefined }));
    expect(turns).toEqual([{ role: "user", text: "real question" }]);
  });

  it("produces history the answerer can use (ends on a user turn)", () => {
    const trigger = m("2", OP, "q2");
    const { turns } = buildThreadHistory([m(THREAD, OP, "q1"), m("1", BOT, "a1"), trigger], ctx(trigger));
    const out = buildMessages(turns, "forum");
    expect(out.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("buildSingleTurn", () => {
  it("returns just the cleaned message", () => {
    expect(buildSingleTurn(`<@${BOT}> how do I import leads?`, BOT)).toEqual([{ role: "user", text: "how do I import leads?" }]);
  });
});

describe("buildThreadHistory: question counts re-derived from the bot's counter markers", () => {
  const bot = (id: string, content: string): ThreadMessage => m(id, BOT, content);
  const op = (id: string, content: string): ThreadMessage => m(id, OP, content);
  const run = (messages: ThreadMessage[], over: Partial<HistoryContext> = {}) => {
    const trigger = op("last", "my answer");
    return buildThreadHistory([...messages, trigger], ctx(trigger, over));
  };
  const start = op(THREAD, "my texts aren't sending");

  it("is empty before the bot has asked anything", () => {
    const h = run([start]);
    expect(h.progress).toEqual({ diagnoseAsked: 0, clarifyUsed: false });
    expect(h.diagnoseTurns).toBe(0);
  });

  it("counts diagnose questions from their markers (the newest number wins)", () => {
    const h = run([start, bot("b1", "Q1?\n-# Check 1 of 4"), op("o1", "green"), bot("b2", "Q2?\n-# Check 2 of 4"), op("o2", "ok"), bot("b3", "Q3?\n-# Check 3 of 4")]);
    expect(h.progress).toEqual({ diagnoseAsked: 3, clarifyUsed: false });
    expect(h.diagnoseTurns).toBe(3);
    expect(h.botTurns).toBe(3);
  });

  it("notices a clarify, and counts both kinds in one run", () => {
    const h = run([start, bot("b1", "Which one?\n-# Quick question"), op("o1", "texts"), bot("b2", "Banner color?\n-# Check 1 of 4")]);
    expect(h.progress).toEqual({ diagnoseAsked: 1, clarifyUsed: true });
  });

  it("starts a new run after an answer or a handoff (any bot post without a marker)", () => {
    const answered = run([start, bot("b1", "Q1?\n-# Check 1 of 4"), op("o1", "x"), bot("b2", "Here is the answer.")]);
    expect(answered.progress).toEqual({ diagnoseAsked: 0, clarifyUsed: false });
    expect(answered.diagnoseTurns).toBe(1); // still a troubleshooting thread
    const handedOff = run([start, bot("b1", "Q?\n-# Quick question"), op("o1", "x"), bot("b2", QA_TEXT.handoff("555555555555555555"))]);
    expect(handedOff.progress).toEqual({ diagnoseAsked: 0, clarifyUsed: false });
  });

  it("counts a second run on its own, and keeps the thread-wide diagnose total", () => {
    const h = run([start, bot("b1", "Q1?\n-# Check 1 of 4"), op("o1", "x"), bot("b2", "Answer."), op("o2", "new problem"), bot("b3", "QA?\n-# Check 1 of 4")]);
    expect(h.progress).toEqual({ diagnoseAsked: 1, clarifyUsed: false });
    expect(h.diagnoseTurns).toBe(2);
  });

  it("the rate-limit note doesn't end a run", () => {
    const h = run([start, bot("b1", "Q1?\n-# Check 1 of 4"), op("o1", "x"), bot("b2", QA_TEXT.rateLimited)]);
    expect(h.progress).toEqual({ diagnoseAsked: 1, clarifyUsed: false });
  });

  it("only the bot's own messages count: members, staff and other bots can't forge a marker", () => {
    const forged = "Q?\n-# Check 4 of 4";
    const h = run([start, op("o1", forged), m("s1", "100000000000000003", forged), m("x1", "100000000000000009", forged)]);
    expect(h.progress).toEqual({ diagnoseAsked: 0, clarifyUsed: false });
    expect(h.diagnoseTurns).toBe(0);
  });

  it("survives a deleted earlier question: the newest marker still says how many were asked", () => {
    const h = run([start, bot("b3", "Q3?\n-# Check 3 of 4")]);
    expect(h.progress.diagnoseAsked).toBe(3);
  });

  it("never shows the model a marker: assistant turns are stripped", () => {
    const h = run([start, bot("b1", "Banner color?\n-# Check 1 of 4")]);
    expect(h.turns.find((t) => t.role === "assistant")?.text).toBe("Banner color?");
    expect(JSON.stringify(h.turns)).not.toContain("-#");
  });

  it("system messages by the bot don't count", () => {
    const h = run([start, m("sys", BOT, "Q?\n-# Check 2 of 4", true)]);
    expect(h.progress.diagnoseAsked).toBe(0);
    expect(h.botTurns).toBe(0);
  });
});

describe("buildThreadHistory: previousQuestionId", () => {
  const bot = (id: string, content: string): ThreadMessage => m(id, BOT, content);
  const op = (id: string, content: string): ThreadMessage => m(id, OP, content);
  const ofRun = (messages: ThreadMessage[]) => {
    const trigger = op("last", "reply");
    return buildThreadHistory([...messages, trigger], ctx(trigger)).previousQuestionId;
  };

  it("is the bot's latest message when that is a diagnose question", () => {
    expect(ofRun([op(THREAD, "x"), bot("b1", "Q?\n-# Check 1 of 4")])).toBe("b1");
    expect(ofRun([op(THREAD, "x"), bot("b1", "Q?\n-# Check 1 of 4"), op("o", "y"), bot("b2", "Q2?\n-# Check 2 of 4")])).toBe("b2");
  });
  it("is undefined when the latest bot message was an answer, a clarify, or there is none", () => {
    expect(ofRun([op(THREAD, "x"), bot("b1", "Q?\n-# Check 1 of 4"), bot("b2", "Answer.")])).toBeUndefined();
    expect(ofRun([op(THREAD, "x"), bot("b1", "Q?\n-# Quick question")])).toBeUndefined();
    expect(ofRun([op(THREAD, "x")])).toBeUndefined();
  });
  it("ignores system messages and other authors", () => {
    expect(ofRun([op(THREAD, "x"), bot("b1", "Q?\n-# Check 1 of 4"), m("s", BOT, "added", true), m("o2", "100000000000000009", "chatter")])).toBe("b1");
  });
});
