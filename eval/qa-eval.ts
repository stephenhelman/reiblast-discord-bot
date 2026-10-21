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
import { CASES, type EvalCase } from "./qa-cases.js";

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

const MENTION = /@everyone|@here|<@/i;

interface RunResult {
  caseId: string;
  run: number;
  pass: boolean;
  problems: string[];
  result: AnswerResult;
  usage: CallUsage | undefined;
}

function check(c: EvalCase, r: AnswerResult): string[] {
  const problems: string[] = [];
  if (!r.ok) return [`ok:false (${r.reason})`];
  if (r.outcome !== c.expect) problems.push(`outcome ${r.outcome}, expected ${c.expect}`);
  if (r.outcome === "answered") {
    if (c.anyOfIds && !r.kbIds.some((id) => c.anyOfIds!.includes(id))) problems.push(`cited ${r.kbIds.join(",")}, expected one of ${c.anyOfIds.join(",")}`);
    if (r.reply.length > 2000) problems.push(`reply ${r.reply.length} chars (>2000)`);
  }
  if ("reply" in r) {
    if (!r.reply.trim()) problems.push("empty reply");
    if (MENTION.test(r.reply)) problems.push("reply contains a mention");
  }
  return problems;
}

const results: RunResult[] = [];
for (const c of CASES) {
  for (let run = 1; run <= c.runs; run++) {
    lastUsage = undefined;
    const result = await answer({ history: c.history, priorClarify: c.priorClarify });
    const problems = check(c, result);
    results.push({ caseId: c.id, run, pass: problems.length === 0, problems, result, usage: lastUsage });
    process.stdout.write(problems.length === 0 ? "." : "F");
  }
}
process.stdout.write("\n\n");

const pad = (s: string, n: number) => s.padEnd(n);
console.log(`${pad("case", 5)} ${pad("group", 14)} ${pad("expect", 17)} ${pad("got", 17)} ${pad("pass", 5)} ${pad("cited", 22)} notes`);
for (const c of CASES) {
  const rs = results.filter((r) => r.caseId === c.id);
  const passed = rs.filter((r) => r.pass).length;
  const got = [...new Set(rs.map((r) => (r.result.ok ? r.result.outcome : `ok:false/${r.result.reason}`)))].join("|");
  const cited = [...new Set(rs.flatMap((r) => (r.result.ok && r.result.outcome === "answered" ? r.result.kbIds : [])))].join(",");
  const notes = [...new Set(rs.flatMap((r) => r.problems))].join("; ");
  console.log(`${pad(c.id, 5)} ${pad(c.group, 14)} ${pad(c.expect, 17)} ${pad(got, 17)} ${pad(`${passed}/${rs.length}`, 5)} ${pad(cited.slice(0, 22), 22)} ${notes}`);
}

const total = results.length;
const passedTotal = results.filter((r) => r.pass).length;
console.log(`\n${passedTotal}/${total} runs passed; ${CASES.filter((c) => results.filter((r) => r.caseId === c.id).every((r) => r.pass)).length}/${CASES.length} cases fully passed`);

const answeredRuns = results.filter((r) => r.result.ok && r.result.outcome === "answered");
const withIds = answeredRuns.filter((r) => CASES.find((c) => c.id === r.caseId)?.anyOfIds);
const primaryFirst = withIds.filter((r) => r.result.ok && r.result.outcome === "answered" && CASES.find((c) => c.id === r.caseId)!.anyOfIds!.includes(r.result.kbIds[0]!));
console.log(`primary entry listed first (informational, not scored): ${primaryFirst.length}/${withIds.length} answered runs`);
const lens = answeredRuns.map((r) => (r.result.ok && r.result.outcome === "answered" ? r.result.reply.length : 0));
console.log(`answered reply length: max ${Math.max(...lens)}, avg ${Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)}, over 600: ${lens.filter((n) => n > 600).length}/${lens.length}`);

console.log("\ncache / token usage per call (call #, case.run, input, cache_read, cache_write, output, stop):");
results.forEach((r, i) => {
  const u = r.usage;
  console.log(`${String(i + 1).padStart(2)}  ${pad(`${r.caseId}.${r.run}`, 6)} ${u ? `in=${u.input} cache_read=${u.cacheRead} cache_write=${u.cacheWrite} out=${u.output} stop=${u.stop}` : "(no response)"}`);
});

const failures = results.filter((r) => !r.result.ok);
console.log(`\nok:false results: ${failures.length}`);
for (const f of failures) console.log(`  ${f.caseId}.${f.run}: ${f.result.ok ? "" : f.result.reason}`);
if (warnings.length) console.log(`\nanswerer warnings (${warnings.length}):\n${warnings.map((w) => `  ${w}`).join("\n")}`);

const out = process.argv[2];
if (out) {
  writeFileSync(out, JSON.stringify({ cases: CASES.map((c) => ({ id: c.id, history: c.history })), results }, null, 2));
  console.log(`\nfull results written to ${out}`);
}
