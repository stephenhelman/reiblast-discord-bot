/**
 * Counter markers: a small subtext line the CODE appends to each question the bot posts in a forum thread, so the
 * question counts can be re-derived from the thread after a restart (like botTurns). They are written only by code
 * (the answerer strips any "-#" line from model text), counted only on bot-authored messages (members can't forge
 * them), and stripped from the history the model sees. They double as a progress cue for the member.
 *
 *   diagnose:  -# Check 2 of 4
 *   clarify:   -# Quick question
 */
import { MAX_DIAGNOSE } from "./progress.js";

export const CLARIFY_MARKER = "-# Quick question";

export function diagnoseMarker(n: number): string {
  return `-# Check ${n} of ${MAX_DIAGNOSE}`;
}

export type Marker = { kind: "diagnose"; n: number } | { kind: "clarify" };

const DIAGNOSE_LINE = /^-# Check (\d{1,2}) of (\d{1,2})$/;
const ANY_MARKER_LINE = /^\s*-# (?:Check \d{1,2} of \d{1,2}|Quick question)\s*$/;

/** The marker on a bot message: only its LAST non-empty line counts. */
export function parseMarker(content: string): Marker | null {
  const last = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .at(-1);
  if (!last) return null;
  if (last === CLARIFY_MARKER) return { kind: "clarify" };
  const m = DIAGNOSE_LINE.exec(last);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= MAX_DIAGNOSE) return { kind: "diagnose", n };
  }
  return null;
}

/** Removes marker lines, so the model never sees (or copies) them in earlier assistant turns. */
export function stripMarkers(text: string): string {
  return text
    .split("\n")
    .filter((line) => !ANY_MARKER_LINE.test(line))
    .join("\n")
    .trim();
}
