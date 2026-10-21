/** Longest case summary we keep (characters). */
export const SUMMARY_MAX = 500;

/** Invisible characters that could hide text or break formatting. */
const INVISIBLE = new RegExp("[\\u200b-\\u200f\\u2028\\u2029\\u2060\\ufeff]", "g");

/** Removes lines that start with Discord's subtext marker "-#" — the bot's own counter markers must come only from code. */
export function stripSubtext(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*-#/.test(line))
    .join("\n")
    .trim();
}

/**
 * Makes model-written case-summary text safe to show staff: mention markup (user, role, channel, @everyone, @here)
 * replaced with a neutral token, subtext / headings / code fences removed, whitespace collapsed to one line, capped.
 */
export function sanitizeSummary(text: string): string {
  const flat = stripSubtext(text)
    .replace(INVISIBLE, "")
    .replace(/<@!?\d+>/g, "[mention]")
    .replace(/<@&\d+>/g, "[role mention]")
    .replace(/<#\d+>/g, "[channel]")
    .replace(/@(everyone|here)\b/gi, "[mention]")
    .replace(/```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : flat;
}
