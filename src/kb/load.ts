import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATEGORIES, parseCategory, renderKbBlock, validateEntries, type KbEntry, type KbIssue } from "./parse.js";

export interface Kb {
  entries: KbEntry[];
  /** Every valid entry ID, for checking the model's kbIds. */
  ids: ReadonlySet<string>;
  /** Rendered <entry> lines for the cached system block. */
  block: string;
  /** Short content hash — safe to log (tells you the KB changed, nothing about what it says). */
  hash: string;
  counts: Record<string, number>;
}

export class KbError extends Error {
  constructor(readonly issues: KbIssue[]) {
    super(`knowledge base invalid: ${issues.length} problem(s)`);
  }
}

/** Resolves to <repo>/kb from both src/kb/ (tsx) and dist/kb/ (compiled). */
export const DEFAULT_KB_DIR = fileURLToPath(new URL("../../kb/", import.meta.url));

/** Reads and validates every category file. Throws KbError listing all problems at once. */
export function loadKb(dir: string = DEFAULT_KB_DIR): Kb {
  const issues: KbIssue[] = [];
  const entries: KbEntry[] = [];
  const counts: Record<string, number> = {};

  const known = new Set(CATEGORIES.map((c) => `${c.file}.md`));
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".md") && !known.has(f)) issues.push({ where: f, message: "unexpected file (not in CATEGORIES)" });
  }

  for (const spec of CATEGORIES) {
    let text: string;
    try {
      text = readFileSync(`${dir}${dir.endsWith("/") ? "" : "/"}${spec.file}.md`, "utf8");
    } catch {
      issues.push({ where: `${spec.file}.md`, message: "file missing or unreadable" });
      continue;
    }
    const parsed = parseCategory(spec, text);
    issues.push(...parsed.issues);
    entries.push(...parsed.entries);
    counts[spec.file] = parsed.entries.length;
  }
  issues.push(...validateEntries(entries));
  if (issues.length > 0) throw new KbError(issues);

  const block = renderKbBlock(entries);
  return {
    entries,
    ids: new Set(entries.map((e) => e.id)),
    block,
    hash: createHash("sha256").update(block).digest("hex").slice(0, 12),
    counts,
  };
}
