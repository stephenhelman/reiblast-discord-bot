import { describe, expect, it } from "vitest";
import { buildThreadHistory, buildSingleTurn, cleanContent, type HistoryContext, type ThreadMessage } from "../src/qa/history.js";
import { buildMessages } from "../src/qa/prompt.js";

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
