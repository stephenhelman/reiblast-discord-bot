import { describe, expect, it } from "vitest";
import { buildMessages, buildSystem, MAX_HISTORY_TURNS, MAX_TURN_CHARS, RULES } from "../src/qa/prompt.js";
import { ANSWER_JSON_SCHEMA, modelAnswerSchema, OUTCOMES } from "../src/qa/schema.js";

describe("buildMessages", () => {
  it("keeps only the last turns, starting on a user turn", () => {
    const history = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), text: `t${i}` }));
    history.push({ role: "user", text: "latest" });
    const out = buildMessages(history, "forum");
    expect(out.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS);
    expect(out[0]?.role).toBe("user");
    expect(out.at(-1)).toEqual({ role: "user", content: "<surface>forum</surface>\n<member_message>latest</member_message>" });
    // earlier user turns carry no surface flag
    expect(out.slice(0, -1).every((m) => !String(m.content).includes("<surface>"))).toBe(true);
  });

  it("allows 16 turns, and leaves a history at or under the limit untouched", () => {
    expect(MAX_HISTORY_TURNS).toBe(16);
    const history = Array.from({ length: MAX_HISTORY_TURNS - 1 }, (_, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), text: `t${i}` }));
    history.push({ role: "user", text: "last" });
    expect(buildMessages(history, "forum")).toHaveLength(MAX_HISTORY_TURNS);
  });

  it("keeps the original post in a 9-exchange thread (pinned first turn + latest turns)", () => {
    const history: Array<{ role: "user" | "assistant"; text: string }> = [{ role: "user", text: "Title: Texts not sending\n\nORIGINAL-POST" }];
    for (let i = 1; i <= 9; i++) {
      history.push({ role: "assistant", text: `bot ${i}` });
      history.push({ role: "user", text: `member ${i}` });
    }
    expect(history).toHaveLength(19);

    const out = buildMessages(history, "forum");
    expect(out).toHaveLength(MAX_HISTORY_TURNS);
    expect(out[0]).toEqual({ role: "user", content: "<member_message>Title: Texts not sending\n\nORIGINAL-POST</member_message>" });
    expect(out.at(-1)).toEqual({ role: "user", content: "<surface>forum</surface>\n<member_message>member 9</member_message>" });
    // the middle was dropped, the most recent turns were kept, and the order is preserved
    expect(JSON.stringify(out)).not.toContain("bot 1<");
    expect(out.slice(1).map((m) => String(m.content).replace(/<surface>.*<\/surface>\n/, "").replace(/<[^>]*>/g, ""))).toEqual(
      history.slice(-(MAX_HISTORY_TURNS - 1)).map((t) => t.text),
    );
  });

  it("does not pin an assistant turn", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? ("assistant" as const) : ("user" as const), text: `t${i}` }));
    history.push({ role: "user", text: "last" });
    const out = buildMessages(history, "forum");
    expect(out[0]?.role).toBe("user");
    expect(out.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS);
  });

  it("caps each turn's length", () => {
    const out = buildMessages([{ role: "user", text: "x".repeat(MAX_TURN_CHARS + 500) }], "chat");
    expect(String(out[0]?.content)).toBe(`<surface>chat</surface>\n<member_message>${"x".repeat(MAX_TURN_CHARS)}</member_message>`);
  });

  it("rejects empty history and history ending on the bot", () => {
    expect(() => buildMessages([], "forum")).toThrow(TypeError);
    expect(() => buildMessages([{ role: "user", text: "a" }, { role: "assistant", text: "b" }], "forum")).toThrow(TypeError);
  });

  it("does not mutate its input", () => {
    const history = [{ role: "assistant" as const, text: "a" }, { role: "user" as const, text: "b" }];
    buildMessages(history, "forum");
    expect(history).toHaveLength(2);
  });
});

describe("system prompt", () => {
  it("is two blocks with the only cache breakpoint on the KB block", () => {
    const s = buildSystem("KB");
    expect(s.map((b) => b.cache_control)).toEqual([undefined, { type: "ephemeral", ttl: "1h" }]);
  });

  it("states the hard rules the guardrails depend on", () => {
    for (const phrase of [
      "ONLY from the knowledge base",
      "account_specific",
      "asking WHY something happened",
      "LOOK AT or CHANGE",
      "cancel, pause, or change a plan",
      "a refund",
      "a billing dispute",
      "is my A2P approved yet",
      "with the primary entry first",
      "Answer only what was asked",
      "under about 600 characters",
      "usual cause, not a diagnosis",
      "Still need help",
      "<surface>forum</surface> or <surface>chat</surface>",
      "post in the support forum and tag it Support",
      "clarify",
      "<member_message>",
      "@everyone",
    ]) {
      expect(RULES).toContain(phrase);
    }
  });

  it("keeps the surface out of the system prompt (it travels in the user turn)", () => {
    expect(RULES).not.toMatch(/<surface>(forum|chat)<\/surface>\n/);
    expect(buildSystem("KB").map((b) => b.text).join()).not.toContain("<surface>forum</surface>\n");
  });

  it("contains nothing that varies per call", () => {
    expect(RULES).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(RULES).not.toMatch(/\$\{|undefined|NaN/);
  });
});

describe("answer schema", () => {
  it("requires every field and forbids extras (what the API schema promises)", () => {
    expect(ANSWER_JSON_SCHEMA.required).toEqual(["outcome", "reply", "kbIds"]);
    expect(ANSWER_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(ANSWER_JSON_SCHEMA.properties.outcome.enum).toEqual([...OUTCOMES]);
  });

  it("accepts a valid object and rejects the rest", () => {
    expect(modelAnswerSchema.safeParse({ outcome: "clarify", reply: "?", kbIds: [] }).success).toBe(true);
    expect(modelAnswerSchema.safeParse({ outcome: "nope", reply: "", kbIds: [] }).success).toBe(false);
    expect(modelAnswerSchema.safeParse({ outcome: "clarify", reply: "?", kbIds: [1] }).success).toBe(false);
  });
});
