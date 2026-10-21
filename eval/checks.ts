/** Pass/fail logic for one eval run, kept apart from the API runner so it can be unit tested. */
import type { AnswerResult } from "../src/qa/answer.js";
import { SUMMARY_MAX } from "../src/qa/sanitize.js";
import type { Outcome } from "../src/qa/schema.js";

export interface EvalExpectation {
  /** The one outcome that passes (unless expectAny is given). */
  expect: Outcome;
  /** Any of these outcomes passes. */
  expectAny?: Outcome[];
  /** For answered / diagnose: at least one of these entries must be cited. */
  anyOfIds?: string[];
  /** A second required group: at least one of these must ALSO be cited (e.g. the entry plus a timeline entry). */
  alsoAnyOfIds?: string[];
  /** Case-insensitive text the reply must contain (all of them / at least one). */
  requireInReply?: string[];
  requireAnyInReply?: string[];
  forbidInReply?: string[];
  /** Case-insensitive text the summary must not contain / must contain at least one of. */
  forbidInSummary?: string[];
  requireAnyInSummary?: string[];
}

const MENTION = /@everyone|@here|<@/i;
/** Real mention markup only: user / role / channel mentions and literal @everyone / @here. Plain words like "@-mention" don't count. */
const MENTION_MARKUP = /<@!?\d+>|<@&\d+>|<#\d+>|@everyone|@here\b/i;

/** A diagnose question must tell the member where to look. */
export const NAVIGATION_CUES = ["settings", "hover", "red triangle", "wallet", "billing", "phone system", "conversation", "banner", "bulk actions", "contacts", "trust settings"];
/** Things only staff could see: a diagnose question must not ask for these. */
export const STAFF_ONLY_TERMS = ["our records", "our system", "our logs", "logs", "carrier records", "internal", "backend", "we can see", "on our end", "twilio"];
/** A staff summary states facts; it must not give advice or address the member. */
export const ADVICE = /\b(should|try|recommend\w*|suggest\w*|advis\w*|please|you|your)\b/i;

const has = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase());

export function checkResult(c: EvalExpectation, r: AnswerResult): string[] {
  if (!r.ok) return [`ok:false (${r.reason})`];
  const problems: string[] = [];
  const allowed = c.expectAny ?? [c.expect];
  if (!allowed.includes(r.outcome)) problems.push(`outcome ${r.outcome}, expected ${allowed.join("|")}`);

  // Questions and answers
  if (r.outcome === "answered" || r.outcome === "diagnose") {
    if (c.anyOfIds && !r.kbIds.some((id) => c.anyOfIds!.includes(id))) problems.push(`cited ${r.kbIds.join(",")}, expected one of ${c.anyOfIds.join(",")}`);
    if (c.alsoAnyOfIds && !r.kbIds.some((id) => c.alsoAnyOfIds!.includes(id))) problems.push(`cited ${r.kbIds.join(",")}, expected also one of ${c.alsoAnyOfIds.join(",")}`);
  }
  if ("reply" in r) {
    if (!r.reply.trim()) problems.push("empty reply");
    if (r.reply.length > 2000) problems.push(`reply ${r.reply.length} chars (>2000)`);
    if (MENTION.test(r.reply)) problems.push("reply contains a mention");
    for (const needle of c.requireInReply ?? []) if (!has(r.reply, needle)) problems.push(`reply lacks "${needle}"`);
    if (c.requireAnyInReply && !c.requireAnyInReply.some((n) => has(r.reply, n))) problems.push(`reply has none of: ${c.requireAnyInReply.join(" | ")}`);
    for (const needle of c.forbidInReply ?? []) if (has(r.reply, needle)) problems.push(`reply contains "${needle}"`);
  }
  if (r.outcome === "diagnose") {
    if (!NAVIGATION_CUES.some((n) => has(r.reply, n))) problems.push("diagnose question doesn't say where to look");
    if ((r.reply.match(/\?/g) ?? []).length > 2) problems.push("diagnose asks more than one question");
    if (r.reply.length > 400) problems.push(`diagnose question is ${r.reply.length} chars (>400)`);
    for (const t of STAFF_ONLY_TERMS) if (has(r.reply, t)) problems.push(`diagnose asks about staff-only "${t}"`);
  }

  // Summary: written every turn, neutral, safe
  if (!r.summary.trim()) problems.push("empty summary");
  if (r.summary.length > SUMMARY_MAX) problems.push(`summary ${r.summary.length} chars (>${SUMMARY_MAX})`);
  if (MENTION_MARKUP.test(r.summary)) problems.push("summary contains real mention markup");
  for (const needle of c.forbidInSummary ?? []) if (has(r.summary, needle)) problems.push(`summary contains "${needle}"`);
  if (c.requireAnyInSummary && !c.requireAnyInSummary.some((n) => has(r.summary, n))) problems.push(`summary has none of: ${c.requireAnyInSummary.join(" | ")}`);

  // The templates for these two are fixed text: the model's reply must not travel.
  if ((r.outcome === "not_covered" || r.outcome === "account_specific") && "reply" in r) problems.push("non-answer result carries a reply");
  return problems;
}

/**
 * Soft findings reported next to the results but never failing a run: blunt word lists, so they can over-flag.
 * - the summary reads like advice or addresses the member
 * - the summary narrates an instruction / the rules, or is written in the first person
 * - a diagnose question may be compound (more than one thing asked)
 */
export function flagResult(r: AnswerResult): string[] {
  if (!r.ok) return [];
  const flags: string[] = [];
  const advice = ADVICE.exec(r.summary);
  if (advice) flags.push(`summary may read as advice / address the member: "${advice[0]}"`);
  const narration = /\b(I|me|my)\b|\b(ignored|instruction|instructed|the rules|asked (?:me|the assistant))\b|\[(?:role )?mention\]/.exec(r.summary);
  if (narration) flags.push(`summary may narrate an instruction or use the first person: "${narration[0]}"`);
  if (r.outcome === "diagnose") {
    const compound = /\btell me\b|\b(?:and|or) (?:do|did|are|is|can|have) you\b|\?[^?]*\?/i.exec(r.reply);
    if (compound) flags.push(`diagnose question may be compound: "${compound[0].trim()}"`);
  }
  return flags;
}
