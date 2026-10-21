import { readFileSync } from "node:fs";

const EMBED_DESCRIPTION_MAX = 4096;
const EMBED_COUNT_MAX = 10;
const MESSAGE_EMBED_CHARS_MAX = 6000;

export const RULES_TITLE = "REIblast Community Rules";

export class RulesError extends Error {}

/** Splits a long string at the last newline/space before `limit` (hard cut if there is none). */
function hardSplit(text: string, limit: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const at = cut > 0 ? cut : limit;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Packs rules text into embed descriptions (≤4096 chars each, split on paragraph boundaries). Throws if the
 * result can't fit one Discord message: ≤10 embeds and ≤6000 characters across titles + descriptions.
 */
export function splitRules(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) throw new RulesError("content/rules.md is empty.");

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of clean.split(/\n{2,}/)) {
    const pieces = paragraph.length > EMBED_DESCRIPTION_MAX ? hardSplit(paragraph, EMBED_DESCRIPTION_MAX) : [paragraph];
    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length <= EMBED_DESCRIPTION_MAX) {
        current = candidate;
      } else {
        chunks.push(current);
        current = piece;
      }
    }
  }
  if (current) chunks.push(current);

  const total = RULES_TITLE.length + chunks.reduce((n, c) => n + c.length, 0);
  if (chunks.length > EMBED_COUNT_MAX || total > MESSAGE_EMBED_CHARS_MAX) {
    throw new RulesError(
      `content/rules.md is too long to send as one message (${total} characters; the limit is ${MESSAGE_EMBED_CHARS_MAX}). ` +
        "Trim it to the key points.",
    );
  }
  return chunks;
}

/** Reads content/rules.md (resolved relative to this module, so it works from src/ and dist/). */
export function loadRules(): string[] {
  let text: string;
  try {
    text = readFileSync(new URL("../../content/rules.md", import.meta.url), "utf8");
  } catch {
    throw new RulesError("Could not read content/rules.md.");
  }
  return splitRules(text);
}
