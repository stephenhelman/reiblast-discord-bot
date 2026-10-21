/**
 * Manual eval of the Q&A answerer against the real API. Run: npm run eval:qa -- [results.json]
 * Needs ANTHROPIC_API_KEY (from .env). Not part of vitest or the bot. The key is never printed; the optional
 * results file holds the (synthetic) case messages and the model's replies, so keep it out of the repo.
 */
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import { loadKb } from "../src/kb/load.js";
import type { Logger } from "../src/logger.js";
import { createAnswerer, type AnswerResult, type QaClient } from "../src/qa/answer.js";
import { checkResult, flagResult } from "./checks.js";
import { CASES } from "./qa-cases.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY in .env first.");
  process.exit(1);
}

const kb = loadKb();
const real = new Anthropic({ apiKey });

interface CallUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  stop: string | null;
}
let lastUsage: CallUsage | undefined;
const client: QaClient = {
  messages: {
    create: async (body, options) => {
      const msg = await real.messages.create(body, options);
      lastUsage = {
        input: msg.usage.input_tokens,
        output: msg.usage.output_tokens,
        cacheRead: msg.usage.cache_read_input_tokens ?? 0,
        cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
        stop: msg.stop_reason,
      };
      return msg;
    },
  },
};

const warnings: string[] = [];
const quiet = {
  debug: () => {},
  info: () => {},
  warn: (m: string, f?: Record<string, unknown>) => warnings.push(`${m} ${JSON.stringify(f ?? {})}`),
  error: (m: string) => warnings.push(m),
} as Logger;
const answer = createAnswerer({ client, kb, logger: quiet });

interface RunResult {
  caseId: string;
  run: number;
  pass: boolean;
  problems: string[];
  /** Soft findings (not failures). */
  flags: string[];
  result: AnswerResult;
  usage: CallUsage | undefined;
}

// Flags: --only=ID,ID filters cases (kept in file order); --once forces 1 run each; --runs=N forces N runs each.
// The first other arg is the results file.
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const once = process.argv.includes("--once");
const runsFlag = Number(process.argv.find((a) => a.startsWith("--runs="))?.slice(7));
const forcedRuns = once ? 1 : Number.isInteger(runsFlag) && runsFlag > 0 ? runsFlag : undefined;
const selected = CASES.filter((c) => !only || only.includes(c.id)).map((c) => (forcedRuns ? { ...c, runs: forcedRuns } : c));

const results: RunResult[] = [];
for (const c of selected) {
  for (let run = 1; run <= c.runs; run++) {
    lastUsage = undefined;
    const result = await answer({ history: c.history, surface: c.surface ?? "forum", progress: c.progress });
    const problems = checkResult(c, result);
    results.push({ caseId: c.id, run, pass: problems.length === 0, problems, flags: flagResult(result), result, usage: lastUsage });
    process.stdout.write(problems.length === 0 ? "." : "F");
  }
}
process.stdout.write("\n\n");

const pad = (s: string, n: number) => s.padEnd(n);
console.log(`${pad("case", 5)} ${pad("group", 14)} ${pad("expect", 17)} ${pad("got", 17)} ${pad("pass", 5)} ${pad("cited", 22)} notes`);
for (const c of selected) {
  const rs = results.filter((r) => r.caseId === c.id);
  const passed = rs.filter((r) => r.pass).length;
  const got = [...new Set(rs.map((r) => (r.result.ok ? r.result.outcome : `ok:false/${r.result.reason}`)))].join("|");
  const cited = [...new Set(rs.flatMap((r) => (r.result.ok && r.result.outcome === "answered" ? r.result.kbIds : [])))].join(",");
  const notes = [...new Set(rs.flatMap((r) => r.problems))].join("; ");
  console.log(`${pad(c.id, 5)} ${pad(c.group, 14)} ${pad(c.expect, 17)} ${pad(got, 17)} ${pad(`${passed}/${rs.length}`, 5)} ${pad(cited.slice(0, 22), 22)} ${notes}`);
}

const total = results.length;
const passedTotal = results.filter((r) => r.pass).length;
console.log(`\n${passedTotal}/${total} runs passed; ${selected.filter((c) => results.filter((r) => r.caseId === c.id).every((r) => r.pass)).length}/${selected.length} cases fully passed`);

const answeredRuns = results.filter((r) => r.result.ok && r.result.outcome === "answered");
const withIds = answeredRuns.filter((r) => CASES.find((c) => c.id === r.caseId)?.anyOfIds);
const primaryFirst = withIds.filter((r) => r.result.ok && r.result.outcome === "answered" && CASES.find((c) => c.id === r.caseId)!.anyOfIds!.includes(r.result.kbIds[0]!));
console.log(`primary entry listed first (informational, not scored): ${primaryFirst.length}/${withIds.length} answered runs`);
const lens = answeredRuns.map((r) => (r.result.ok && r.result.outcome === "answered" ? r.result.reply.length : 0));
console.log(`answered reply length: max ${Math.max(...lens)}, avg ${Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)}, over 600: ${lens.filter((n) => n > 600).length}/${lens.length}`);

const REVIEW_GROUPS = new Set(["diagnose", "a2p-banner", "guided-limits", "summary-safety"]);
console.log("\n--- troubleshooting review: what the bot asked / answered, and the staff summary ---");
for (const r of results) {
  const c = CASES.find((x) => x.id === r.caseId)!;
  if (!REVIEW_GROUPS.has(c.group) || !r.result.ok) continue;
  const res = r.result;
  const said = "reply" in res ? ` | ${res.reply.replace(/\s+/g, " ").slice(0, 260)}` : "";
  console.log(`${r.caseId}.${r.run} [${res.outcome}]${said}\n      summary: ${res.summary}${r.flags.length ? `\n      ⚑ ${r.flags.join("; ")}` : ""}`);
}

console.log(`\nadvice-check flags (not failures): ${results.filter((r) => r.flags.length).length}/${results.length} runs`);
for (const r of results.filter((x) => x.flags.length)) console.log(`  ${r.caseId}.${r.run}: ${r.flags.join("; ")}`);

console.log("\ncache / token usage per call (call #, case.run, input, cache_read, cache_write, output, stop):");
results.forEach((r, i) => {
  const u = r.usage;
  console.log(`${String(i + 1).padStart(2)}  ${pad(`${r.caseId}.${r.run}`, 6)} ${u ? `in=${u.input} cache_read=${u.cacheRead} cache_write=${u.cacheWrite} out=${u.output} stop=${u.stop}` : "(no response)"}`);
});

const failures = results.filter((r) => !r.result.ok);
console.log(`\nok:false results: ${failures.length}`);
for (const f of failures) console.log(`  ${f.caseId}.${f.run}: ${f.result.ok ? "" : f.result.reason}`);
if (warnings.length) console.log(`\nanswerer warnings (${warnings.length}):\n${warnings.map((w) => `  ${w}`).join("\n")}`);

const out = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (out) {
  writeFileSync(out, JSON.stringify({ cases: selected.map((c) => ({ id: c.id, history: c.history })), results }, null, 2));
  console.log(`\nfull results written to ${out}`);
}
