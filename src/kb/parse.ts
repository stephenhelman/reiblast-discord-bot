/**
 * Knowledge-base parsing and validation. Pure functions over strings — file access lives in load.ts.
 *
 * Category file format (kb/<file>.md):
 *   # <category title>
 *   ## <lesson code> <topic>
 *   ### <prefix>-<nnn>
 *   Q: <question>
 *   A: <answer>
 * IDs are immutable and never reused: they appear in staff-log lines and eval fixtures.
 */

export interface CategorySpec {
  /** File name under kb/ without the .md extension. */
  file: string;
  /** ID prefix: every entry in the file is `<prefix>-<3 digits>`. */
  prefix: string;
  /** Must match the file's `# ` title. */
  title: string;
}

/** Order here is the order entries appear in the prompt (stable, so the cached prefix is stable). */
export const CATEGORIES: readonly CategorySpec[] = [
  { file: "onboarding", prefix: "onb", title: "Onboarding" },
  { file: "account-login", prefix: "acc", title: "Account & Login" },
  { file: "a2p-kyc", prefix: "a2p", title: "A2P & KYC" },
  { file: "wallet-billing", prefix: "wal", title: "Wallet & Billing" },
  { file: "sending-troubleshooting", prefix: "snd", title: "Sending & Troubleshooting" },
  { file: "policies", prefix: "pol", title: "Policies" },
  { file: "platform-how-to", prefix: "app", title: "Platform How-To" },
];

export interface KbEntry {
  id: string;
  category: string;
  lesson: string;
  topic: string;
  q: string;
  a: string;
}

export interface KbIssue {
  /** `file.md:line` or `kb`. */
  where: string;
  message: string;
}

/**
 * Text that would ping, or hand the model something that looks like a ping: user/role/channel-style `<@…>`
 * mentions, @everyone, @here. KB text is quoted into replies, so none of it may carry a live mention.
 */
const MENTION_PATTERNS: ReadonlyArray<{ re: RegExp; name: string }> = [
  { re: /<@&[^>]*>/, name: "role mention <@&…>" },
  { re: /<@[^>]*>/, name: "user mention <@…>" },
  { re: /@everyone/i, name: "@everyone" },
  { re: /@here\b/i, name: "@here" },
];

export function findMention(text: string): string | undefined {
  for (const { re, name } of MENTION_PATTERNS) if (re.test(text)) return name;
  return undefined;
}

interface Draft {
  id: string;
  line: number;
  q?: string;
  a?: string;
}

export function parseCategory(spec: CategorySpec, text: string): { entries: KbEntry[]; issues: KbIssue[] } {
  const entries: KbEntry[] = [];
  const issues: KbIssue[] = [];
  const at = (line: number) => `${spec.file}.md:${line}`;
  const idRe = new RegExp(`^${spec.prefix}-\\d{3}$`);

  let sawTitle = false;
  let lesson = "";
  let topic = "";
  let draft: Draft | undefined;
  /** Which field a following non-marker line continues, until the next blank line. */
  let cont: "q" | "a" | undefined;

  const checkMention = (value: string, line: number) => {
    const hit = findMention(value);
    if (hit) issues.push({ where: at(line), message: `contains ${hit}` });
  };

  const finish = () => {
    if (!draft) return;
    const { id, line, q, a } = draft;
    draft = undefined;
    cont = undefined;
    if (!q?.trim()) return void issues.push({ where: at(line), message: `${id}: missing Q:` });
    if (!a?.trim()) return void issues.push({ where: at(line), message: `${id}: missing or empty A:` });
    checkMention(q, line);
    checkMention(a, line);
    entries.push({ id, category: spec.file, lesson, topic, q: q.trim(), a: a.trim() });
  };

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trimEnd();

    if (line === "") {
      cont = undefined;
      return;
    }
    if (line.startsWith("### ")) {
      finish();
      const id = line.slice(4).trim();
      if (!lesson) issues.push({ where: at(n), message: `${id}: entry before any "## <lesson> <topic>" heading` });
      if (!idRe.test(id)) issues.push({ where: at(n), message: `bad id "${id}" (expected ${spec.prefix}-NNN)` });
      draft = { id, line: n };
      return;
    }
    if (line.startsWith("## ")) {
      finish();
      const m = /^(\d+(?:-\d+)*) (.+)$/.exec(line.slice(3).trim());
      if (!m) {
        issues.push({ where: at(n), message: 'lesson heading must be "## <code> <topic>"' });
        lesson = "?";
        topic = "?";
      } else {
        lesson = m[1]!;
        topic = m[2]!.trim();
        checkMention(topic, n);
      }
      return;
    }
    if (line.startsWith("# ")) {
      finish();
      if (sawTitle) issues.push({ where: at(n), message: "second # title" });
      sawTitle = true;
      if (line.slice(2).trim() !== spec.title) issues.push({ where: at(n), message: `title must be "${spec.title}"` });
      return;
    }
    if (draft && line.startsWith("Q:")) {
      if (draft.q !== undefined) issues.push({ where: at(n), message: `${draft.id}: second Q:` });
      draft.q = line.slice(2).trim();
      cont = "q";
      return;
    }
    if (draft && line.startsWith("A:")) {
      if (draft.q === undefined) issues.push({ where: at(n), message: `${draft.id}: A: before Q:` });
      else if (draft.a !== undefined) issues.push({ where: at(n), message: `${draft.id}: second A:` });
      draft.a = line.slice(2).trim();
      cont = "a";
      return;
    }
    if (draft && cont) {
      draft[cont] = `${draft[cont] ?? ""}\n${line.trim()}`;
      return;
    }
    issues.push({ where: at(n), message: "stray text outside an entry" });
  });
  finish();

  if (!sawTitle) issues.push({ where: at(1), message: `missing "# ${spec.title}" title` });
  if (entries.length === 0 && issues.length === 0) issues.push({ where: `${spec.file}.md`, message: "no entries" });
  return { entries, issues };
}

/** Cross-file checks. */
export function validateEntries(entries: readonly KbEntry[]): KbIssue[] {
  const issues: KbIssue[] = [];
  const seen = new Map<string, string>();
  for (const e of entries) {
    const prev = seen.get(e.id);
    if (prev) issues.push({ where: "kb", message: `duplicate id ${e.id} (${prev} and ${e.category})` });
    else seen.set(e.id, e.category);
  }
  return issues;
}

/** Angle brackets are escaped so KB text can never close or forge an <entry> tag. */
function esc(value: string): string {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attr(value: string): string {
  return esc(value).replace(/"/g, "&quot;");
}

/** The KB block of the system prompt. Deterministic: same entries in, same bytes out (no timestamps). */
export function renderKbBlock(entries: readonly KbEntry[]): string {
  return entries
    .map((e) => `<entry id="${e.id}" topic="${attr(e.topic)}"><q>${esc(e.q)}</q><a>${esc(e.a)}</a></entry>`)
    .join("\n");
}
