import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runKbCheck } from "../src/kb/check.js";
import { CATEGORIES } from "../src/kb/parse.js";

function kbDir(answerFor: (prefix: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), "kbcheck-"));
  for (const c of CATEGORIES) {
    writeFileSync(join(dir, `${c.file}.md`), `# ${c.title}\n\n## 1-1 Topic\n\n### ${c.prefix}-001\nQ: q\nA: ${answerFor(c.prefix)}\n`);
  }
  return dir;
}

function run(dir: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runKbCheck(dir, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out, err };
}

describe("runKbCheck", () => {
  it("exits 0 and reports counts for a valid KB", () => {
    const { code, out, err } = run(kbDir(() => "fine"));
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out[0]).toMatch(/^kb ok: 7 entries, hash [0-9a-f]{12}/);
    expect(out).toContain("  onboarding: 1");
  });

  it("exits 1 and names file:line for a mention", () => {
    const { code, out, err } = run(kbDir((p) => (p === "wal" ? "ask <@123456789012345678>" : "fine")));
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toBe("kb check failed: 1 problem(s)");
    expect(err[1]).toBe("  wallet-billing.md:5: contains user mention <@…>");
  });

  it("passes on the real KB", () => {
    expect(run(join(import.meta.dirname, "..", "kb")).code).toBe(0);
  });
});
