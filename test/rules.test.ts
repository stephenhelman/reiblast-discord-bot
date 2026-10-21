import { describe, expect, it } from "vitest";
import { loadRules, RulesError, RULES_TITLE, splitRules } from "../src/verify/rules.js";

describe("splitRules", () => {
  it("keeps short rules in one chunk", () => {
    expect(splitRules("one\n\ntwo")).toEqual(["one\n\ntwo"]);
  });

  it("normalizes CRLF and trims", () => {
    expect(splitRules("\r\n a\r\n\r\nb \r\n")).toEqual(["a\n\nb"]);
  });

  it("splits on paragraph boundaries when over 4096", () => {
    const para = "x".repeat(2500);
    const chunks = splitRules(`${para}\n\n${para}`);
    expect(chunks).toEqual([para, para]);
  });

  it("hard-splits a single oversized paragraph, preferring spaces", () => {
    const text = Array.from({ length: 900 }, () => "word").join(" "); // ~4500 chars, one paragraph
    const chunks = splitRules(text);
    expect(chunks.length).toBe(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4096);
    expect(chunks.join(" ")).toBe(text);
  });

  it("respects the 4096 per-embed limit and the 6000 total", () => {
    const chunks = splitRules(`${"a".repeat(3000)}\n\n${"b".repeat(2900)}`);
    expect(chunks.length).toBe(2);
    expect(RULES_TITLE.length + chunks.join("").length).toBeLessThanOrEqual(6000);
  });

  it("throws a clear error when over 6000 characters total", () => {
    expect(() => splitRules(`${"a".repeat(3500)}\n\n${"b".repeat(3500)}`)).toThrow(RulesError);
    expect(() => splitRules("a".repeat(6000))).toThrow(/too long/);
  });

  it("throws on empty input", () => {
    expect(() => splitRules("  \n ")).toThrow(/empty/);
  });
});

describe("loadRules", () => {
  it("loads and validates the real content/rules.md", () => {
    const chunks = loadRules();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("")).toContain("I agree");
  });
});
