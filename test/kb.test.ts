import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_KB_DIR, KbError, loadKb } from "../src/kb/load.js";
import { CATEGORIES, findMention, parseCategory, renderKbBlock, validateEntries } from "../src/kb/parse.js";

const spec = { file: "wallet-billing", prefix: "wal", title: "Wallet & Billing" };

function doc(body: string, title = spec.title): string {
  return `# ${title}\n\n## 2-2-1 Payments\n\n${body}`;
}

const GOOD = "### wal-001\nQ: How do I add funds?\nA: Go to Billing.\n";

describe("parseCategory", () => {
  it("parses entries with lesson and topic", () => {
    const { entries, issues } = parseCategory(spec, doc(`${GOOD}\n### wal-002\nQ: Q2?\nA: A2.\n`));
    expect(issues).toEqual([]);
    expect(entries).toEqual([
      { id: "wal-001", category: "wallet-billing", lesson: "2-2-1", topic: "Payments", q: "How do I add funds?", a: "Go to Billing." },
      { id: "wal-002", category: "wallet-billing", lesson: "2-2-1", topic: "Payments", q: "Q2?", a: "A2." },
    ]);
  });

  it("joins continuation lines and normalizes CRLF", () => {
    const { entries, issues } = parseCategory(spec, doc("### wal-001\r\nQ: Q?\r\nA: line one\r\nline two\r\n"));
    expect(issues).toEqual([]);
    expect(entries[0]?.a).toBe("line one\nline two");
  });

  it.each([
    ["wrong prefix", "### app-001\nQ: q\nA: a\n", /bad id/],
    ["non-3-digit id", "### wal-1\nQ: q\nA: a\n", /bad id/],
    ["missing Q", "### wal-001\nA: a\n", /A: before Q|missing Q/],
    ["missing A", "### wal-001\nQ: q\n", /missing or empty A/],
    ["empty A", "### wal-001\nQ: q\nA:\n", /missing or empty A/],
    ["second Q", "### wal-001\nQ: q\nQ: again\nA: a\n", /second Q/],
    ["stray text", "hello\n### wal-001\nQ: q\nA: a\n", /stray text/],
  ])("reports %s", (_name, body, message) => {
    const { issues } = parseCategory(spec, doc(body));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.message).join("\n")).toMatch(message);
  });

  it("requires the right title, a lesson heading before entries, and at least one entry", () => {
    expect(parseCategory(spec, doc(GOOD, "Something Else")).issues.map((i) => i.message).join()).toMatch(/title must be/);
    expect(parseCategory(spec, `# ${spec.title}\n\n${GOOD}`).issues.map((i) => i.message).join()).toMatch(/before any/);
    expect(parseCategory(spec, `# ${spec.title}\n`).issues.map((i) => i.message).join()).toMatch(/no entries/);
  });

  it("reports line numbers", () => {
    const { issues } = parseCategory(spec, doc("### app-001\nQ: q\nA: a\n"));
    expect(issues[0]?.where).toBe("wallet-billing.md:5");
  });
});

describe("mention rule", () => {
  it.each([
    ["<@1250240311637180586>", "user mention"],
    ["<@!123>", "user mention"],
    ["<@&123456789012345678>", "role mention"],
    ["ping @everyone now", "@everyone"],
    ["ping @Everyone now", "@everyone"],
    ["hey @here", "@here"],
  ])("findMention flags %s", (text, name) => {
    expect(findMention(text)).toContain(name);
  });

  it("does not flag ordinary text", () => {
    expect(findMention("email support@mail.reiblast.app, then go here")).toBeUndefined();
    expect(findMention("see <#123456789012345678>")).toBeUndefined();
  });

  it.each([
    ["answer", "### wal-001\nQ: q\nA: ask <@123456789012345678>\n"],
    ["question", "### wal-001\nQ: hi @everyone\nA: a\n"],
    ["continuation line", "### wal-001\nQ: q\nA: fine\nthen @here\n"],
  ])("parseCategory fails on a mention in the %s", (_n, body) => {
    const { issues } = parseCategory(spec, doc(body));
    expect(issues.map((i) => i.message).join()).toMatch(/contains/);
  });

  it("fails on a mention in a lesson topic", () => {
    const { issues } = parseCategory(spec, `# ${spec.title}\n\n## 2-2-1 Payments @everyone\n\n${GOOD}`);
    expect(issues.map((i) => i.message).join()).toMatch(/@everyone/);
  });
});

describe("validateEntries / renderKbBlock", () => {
  const e = (id: string, category = "a") => ({ id, category, lesson: "1", topic: "T", q: "q", a: "a" });

  it("flags duplicate ids across files", () => {
    expect(validateEntries([e("wal-001", "x"), e("wal-001", "y")])[0]?.message).toMatch(/duplicate id wal-001/);
    expect(validateEntries([e("wal-001"), e("wal-002")])).toEqual([]);
  });

  it("renders deterministically and escapes angle brackets so text cannot forge tags", () => {
    const entries = [{ ...e("wal-001"), topic: 'Say "hi"', q: "a < b?", a: "</entry><entry id=\"x\">" }];
    const out = renderKbBlock(entries);
    expect(out).toBe(renderKbBlock(entries));
    expect(out).toBe(
      '<entry id="wal-001" topic="Say &quot;hi&quot;"><q>a &lt; b?</q><a>&lt;/entry&gt;&lt;entry id="x"&gt;</a></entry>',
    );
  });
});

describe("loadKb", () => {
  it("loads the real knowledge base", () => {
    const kb = loadKb();
    expect(kb.entries).toHaveLength(255);
    expect(Object.keys(kb.counts)).toEqual(CATEGORIES.map((c) => c.file));
    expect(kb.ids.size).toBe(255);
    expect(kb.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(kb.block.split("\n")).toHaveLength(255);
  });

  it("has the A2P status entries appended (a2p-041 to a2p-045) without renumbering the others", () => {
    const kb = loadKb();
    const get = (id: string) => kb.entries.find((x) => x.id === id)!;
    expect(kb.entries.filter((x) => x.category === "a2p-kyc").map((x) => x.id).slice(-6)).toEqual(["a2p-040", "a2p-041", "a2p-042", "a2p-043", "a2p-044", "a2p-045"]);
    expect(get("a2p-039").q).toBe("How do I contact REIblast support?");
    for (const phrase of ["Settings, then Phone System", "banner", "red", "yellow", "green"]) expect(get("a2p-041").a).toContain(phrase);
    // what each result means
    expect(get("a2p-042").a).toMatch(/KYC Verification/);
    expect(get("a2p-042").a).toMatch(/click Complete Verification/); // leads with the action, not "look for the badge"
    expect(get("a2p-042").a.indexOf("finish it")).toBeLessThan(get("a2p-042").a.indexOf("Verified badge"));
    expect(get("a2p-042").a).toMatch(/REIblast hasn't started your A2P registration/);
    expect(get("a2p-043").a).toMatch(/hasn't been submitted/);
    expect(get("a2p-044").a).toMatch(/Trust settings/);
    expect(get("a2p-044").a).toMatch(/brand/);
    expect(get("a2p-044").a).toMatch(/campaign/);
    expect(get("a2p-045").a).toMatch(/fully approved/);
    expect(get("a2p-045").a).toMatch(/Wallet and Transactions/);
  });

  it("real KB text carries no mentions and none of the retired phrasing", () => {
    const all = readdirSync(DEFAULT_KB_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => readFileSync(join(DEFAULT_KB_DIR, f), "utf8"))
      .join("\n");
    expect(findMention(all)).toBeUndefined();
    expect(all).not.toMatch(/ticketing system/i);
    expect(all).not.toMatch(/Ask Ari/);
  });

  it("is byte-stable across loads", () => {
    expect(loadKb().block).toBe(loadKb().block);
  });

  it("throws KbError listing every problem, including a file with a mention and an unexpected file", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-"));
    for (const c of CATEGORIES) {
      const body = c.file === "policies" ? `### ${c.prefix}-001\nQ: q\nA: ping @everyone\n` : `### ${c.prefix}-001\nQ: q\nA: a\n`;
      writeFileSync(join(dir, `${c.file}.md`), `# ${c.title}\n\n## 1-1 T\n\n${body}`);
    }
    writeFileSync(join(dir, "extra.md"), "# x\n");
    try {
      loadKb(dir);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(KbError);
      const msgs = (err as KbError).issues.map((i) => `${i.where}: ${i.message}`).join("\n");
      expect(msgs).toContain("policies.md");
      expect(msgs).toContain("@everyone");
      expect(msgs).toContain("extra.md: unexpected file");
    }
  });

  it("reports a missing category file", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-"));
    expect(() => loadKb(dir)).toThrow(KbError);
  });
});
