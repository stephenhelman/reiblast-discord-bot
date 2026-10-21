import { describe, expect, it } from "vitest";
import type { AnswerResult } from "../src/qa/answer.js";
import { loadKb } from "../src/kb/load.js";
import { checkResult, flagResult, type EvalExpectation } from "../eval/checks.js";
import { CASES } from "../eval/qa-cases.js";

const S = "Member reports texts not sending; says the banner is green.";
const diagnose = (over: Partial<Extract<AnswerResult, { outcome: "diagnose" }>> = {}): AnswerResult => ({
  ok: true,
  outcome: "diagnose",
  reply: "Go to Settings, then Billing, then Wallet and Transactions. Is your balance above zero?",
  kbIds: ["wal-014"],
  summary: S,
  ...over,
});
const answered = (over: object = {}): AnswerResult => ({ ok: true, outcome: "answered", reply: "Open Settings, then Phone System.", kbIds: ["a2p-041"], summary: S, ...over }) as AnswerResult;
const none = (outcome: "not_covered" | "account_specific", summary = S): AnswerResult => ({ ok: true, outcome, summary });
const exp = (over: Partial<EvalExpectation> = {}): EvalExpectation => ({ expect: "diagnose", ...over });

describe("checkResult: outcomes and citations", () => {
  it("passes a clean diagnose question", () => {
    expect(checkResult(exp({ anyOfIds: ["wal-014"] }), diagnose())).toEqual([]);
  });
  it("fails on the wrong outcome, accepts any of expectAny", () => {
    expect(checkResult(exp({ expect: "answered" }), diagnose())[0]).toMatch(/outcome diagnose, expected answered/);
    expect(checkResult(exp({ expect: "answered", expectAny: ["answered", "diagnose"] }), diagnose())).toEqual([]);
  });
  it("requires one of the expected entries to be cited", () => {
    expect(checkResult(exp({ anyOfIds: ["snd-042"] }), diagnose())[0]).toMatch(/cited wal-014, expected one of snd-042/);
  });
  it("reports ok:false", () => {
    expect(checkResult(exp(), { ok: false, reason: "timeout" })).toEqual(["ok:false (timeout)"]);
  });
  it("checks required / forbidden reply text, case-insensitively", () => {
    const c = exp({ requireInReply: ["BALANCE"], requireAnyInReply: ["banner", "wallet"], forbidInReply: ["a2p"] });
    expect(checkResult(c, diagnose())).toEqual([]);
    expect(checkResult(exp({ forbidInReply: ["wallet"] }), diagnose())[0]).toMatch(/contains "wallet"/);
    expect(checkResult(exp({ requireAnyInReply: ["trust"] }), diagnose())[0]).toMatch(/none of/);
  });
  it("flags a mention in a reply", () => {
    expect(checkResult(exp({ expect: "answered" }), answered({ reply: "hi @everyone" })).join()).toMatch(/mention/);
  });
  it("flags a reply riding on a not_covered / account_specific result", () => {
    const bad = { ...none("not_covered"), reply: "text" } as unknown as AnswerResult;
    expect(checkResult(exp({ expect: "not_covered" }), bad).join()).toMatch(/non-answer result carries a reply/);
  });
});

describe("checkResult: diagnose questions", () => {
  it("must say where to look", () => {
    expect(checkResult(exp(), diagnose({ reply: "Is your balance okay?" })).join()).toMatch(/doesn't say where to look/);
  });
  it("must be one question", () => {
    expect(checkResult(exp(), diagnose({ reply: "In Settings, what is it? And what else? And more?" })).join()).toMatch(/more than one question/);
  });
  it("must stay short", () => {
    expect(checkResult(exp(), diagnose({ reply: `Go to Settings. ${"word ".repeat(100)}?` })).join()).toMatch(/chars \(>400\)/);
  });
  it("must not ask for anything only staff can see", () => {
    expect(checkResult(exp(), diagnose({ reply: "In Settings, can you send me your logs?" })).join()).toMatch(/staff-only "logs"/);
  });
});

describe("checkResult: summary", () => {
  it("must be present, short, and free of mention characters", () => {
    expect(checkResult(exp(), diagnose({ summary: "" })).join()).toMatch(/empty summary/);
    expect(checkResult(exp(), diagnose({ summary: "x ".repeat(300) })).join()).toMatch(/summary \d+ chars/);
    expect(checkResult(exp(), diagnose({ summary: "Member says [mention]@here" })).join()).toMatch(/mention character/);
  });
  it("advice-like wording is flagged but never fails the run", () => {
    for (const bad of ["Member should check the wallet.", "Try the wallet.", "Please add funds.", "Your wallet is empty.", "We recommend a new card."]) {
      expect(checkResult(exp(), diagnose({ summary: bad })), bad).toEqual([]);
      expect(flagResult(diagnose({ summary: bad })).join(), bad).toMatch(/advice/);
    }
    expect(flagResult(diagnose({ summary: "Member checked the wallet and reports a balance of $40." }))).toEqual([]);
    expect(flagResult({ ok: false, reason: "timeout" })).toEqual([]);
  });

  it("checks forbidden and required summary text", () => {
    expect(checkResult(exp({ forbidInSummary: ["banner"] }), diagnose())[0]).toMatch(/summary contains "banner"/);
    expect(checkResult(exp({ requireAnyInSummary: ["a2p", "wallet"] }), diagnose())[0]).toMatch(/summary has none of/);
    expect(checkResult(exp({ requireAnyInSummary: ["texts"] }), diagnose())).toEqual([]);
  });
});

describe("the eval case file", () => {
  const kb = loadKb();

  it("has unique ids and at least one run each", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CASES) expect(c.runs, c.id).toBeGreaterThanOrEqual(1);
  });

  it("only cites knowledge-base entries that exist", () => {
    for (const c of CASES) for (const id of c.anyOfIds ?? []) expect(kb.ids.has(id), `${c.id}: ${id}`).toBe(true);
  });

  it("every history ends on the member's message and starts with one", () => {
    for (const c of CASES) {
      expect(c.history[0]?.role, c.id).toBe("user");
      expect(c.history.at(-1)?.role, c.id).toBe("user");
    }
  });

  it("scripted walk-throughs carry progress that matches the questions already asked", () => {
    for (const c of CASES) {
      if (!c.progress) continue;
      const botTurns = c.history.filter((t) => t.role === "assistant").length;
      expect(c.progress.diagnoseAsked + (c.progress.clarifyUsed ? 1 : 0), c.id).toBe(botTurns);
    }
  });

  it("covers the approved troubleshooting scenarios", () => {
    const by = (id: string) => CASES.find((c) => c.id === id)!;
    expect(by("T1").expect).toBe("diagnose");
    expect(by("T5").expect).toBe("answered");
    expect(by("T6").anyOfIds).toEqual(["snd-050"]);
    expect(by("T13").expect).toBe("not_covered");
    expect(by("T13").progress?.diagnoseAsked).toBe(4);
    expect(by("T14").expect).toBe("account_specific");
    expect(by("T17").expect).toBe("not_covered");
    // each A2P banner result
    expect(by("T8").anyOfIds).toEqual(["a2p-044"]);
    expect(by("T9").expect).toBe("account_specific");
    expect(by("T10").expect).toBe("account_specific");
    expect(by("T11").expect).toBe("answered");
    expect(by("B4").expect).toBe("answered");
    expect(by("B4").anyOfIds).toEqual(["a2p-041"]);
    // summary safety
    for (const id of ["T19", "T20", "T21"]) expect(by(id).group).toBe("summary-safety");
  });

  it("keeps every original regression case (35, including the two chat ones; only B4 changed)", () => {
    const orig = ["A1","A2","A3","A4","A5","A6","A7","A8","A9","A10","A11","A12","B1","B2","B3","B4","B5","B6","C1","C2","C3","C4","N1","N2","N3","V1","V2","V3","D1","D2","D3","D4","D5","E1","E2"];
    for (const id of orig) expect(CASES.some((c) => c.id === id), id).toBe(true);
  });
});
