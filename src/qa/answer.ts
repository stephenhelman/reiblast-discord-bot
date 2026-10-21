import Anthropic from "@anthropic-ai/sdk";
import type { Kb } from "../kb/load.js";
import { createLogger, type Logger } from "../logger.js";
import { buildMessages, buildSystem, type HistoryTurn, type Surface } from "./prompt.js";
import { MAX_DIAGNOSE, NO_PROGRESS, type QuestionProgress } from "./progress.js";
import { sanitizeSummary, stripSubtext } from "./sanitize.js";
import { ANSWER_JSON_SCHEMA, modelAnswerSchema } from "./schema.js";

export const MODEL = "claude-haiku-5-5";
export const TIMEOUT_MS = 20_000;
/** Thinking counts toward max_tokens on Haiku 5.5, so this leaves room for it plus a ~1,200-char reply. */
export const MAX_TOKENS = 1024;

/** Why no usable answer came back. Callers treat every one of these like not_covered (never post model text). */
export type QaFailure = "api_error" | "timeout" | "refusal" | "max_tokens" | "bad_output";

/** A guardrail changed what the model said. Logged as a reason code. */
export type AnswerNote = "no_valid_kb_ids" | "repeat_clarify" | "diagnose_cap" | "diagnose_chat";

/** Every ok result carries the model's case summary, sanitised (plain text, no mentions, at most 500 characters; may be empty). */
export type AnswerResult =
  | { ok: true; outcome: "answered"; reply: string; kbIds: string[]; summary: string }
  | { ok: true; outcome: "clarify"; reply: string; summary: string }
  /** One guided-troubleshooting question. `kbIds` are the entries it is drawn from. */
  | { ok: true; outcome: "diagnose"; reply: string; kbIds: string[]; summary: string }
  /** No model reply text is carried: the caller posts its fixed template. */
  | { ok: true; outcome: "not_covered" | "account_specific"; note?: AnswerNote; summary: string }
  | { ok: false; reason: QaFailure };

export interface AnswerInput {
  /** Thread history, oldest first, ending with the member's new message. */
  history: readonly HistoryTurn[];
  /** Where the reply will be posted; shapes the closing pointer and whether questions are allowed. */
  surface: Surface;
  /** Question counts in the current run (forum only; chat has none). */
  progress?: QuestionProgress;
}

/** The slice of the SDK we use, so tests can fake it. */
export interface QaClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming, options?: Anthropic.RequestOptions): Promise<Anthropic.Message>;
  };
}

export function createAnthropicClient(apiKey: string): QaClient {
  return new Anthropic({ apiKey });
}

export function createAnswerer(opts: { client: QaClient; kb: Pick<Kb, "block" | "ids">; logger?: Logger }) {
  const { client, kb } = opts;
  const log = opts.logger ?? createLogger("qa");
  const system = buildSystem(kb.block);

  const fail = (reason: QaFailure, fields: Record<string, number | string> = {}): AnswerResult => {
    log.warn("answer failed", { reason, ...fields });
    return { ok: false, reason };
  };

  return async function answer(input: AnswerInput): Promise<AnswerResult> {
    const progress = input.progress ?? NO_PROGRESS;
    const messages = buildMessages(input.history, input.surface, progress);

    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages,
          output_config: { effort: "low", format: { type: "json_schema", schema: ANSWER_JSON_SCHEMA } },
        },
        { timeout: TIMEOUT_MS, maxRetries: 1 },
      );
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionTimeoutError) return fail("timeout");
      return fail("api_error", { error: err instanceof Error ? err.name : "unknown", status: err instanceof Anthropic.APIError ? (err.status ?? 0) : 0 });
    }

    // Counts only — token usage lets us confirm the KB block is being served from cache.
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
      cache_write: response.usage.cache_creation_input_tokens ?? 0,
    };

    if (response.stop_reason === "refusal") return fail("refusal", usage);
    if (response.stop_reason === "max_tokens") return fail("max_tokens", usage);

    // Read by type, not position: a response can begin with thinking blocks.
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
    let parsed;
    try {
      parsed = modelAnswerSchema.safeParse(JSON.parse(text ?? ""));
    } catch {
      return fail("bad_output", usage);
    }
    if (!parsed.success) return fail("bad_output", usage);
    const { outcome } = parsed.data;
    const reply = stripSubtext(parsed.data.reply);
    const summary = sanitizeSummary(parsed.data.summary);
    const validIds = [...new Set(parsed.data.kbIds)].filter((id) => kb.ids.has(id));

    let result: AnswerResult;
    let note: AnswerNote | undefined;
    const downgrade = (n: AnswerNote): AnswerResult => {
      note = n;
      return { ok: true, outcome: "not_covered", note: n, summary };
    };

    if (outcome === "answered") {
      // An answer that cites nothing real is a guess by another name.
      if (validIds.length === 0) result = downgrade("no_valid_kb_ids");
      else if (!reply) return fail("bad_output", usage);
      else result = { ok: true, outcome: "answered", reply, kbIds: validIds, summary };
    } else if (outcome === "clarify") {
      if (progress.clarifyUsed) result = downgrade("repeat_clarify");
      else if (!reply) return fail("bad_output", usage);
      else result = { ok: true, outcome: "clarify", reply, summary };
    } else if (outcome === "diagnose") {
      // Questions need a thread to answer in, are capped, and must come from a real KB check.
      if (input.surface === "chat") result = downgrade("diagnose_chat");
      else if (progress.diagnoseAsked >= MAX_DIAGNOSE) result = downgrade("diagnose_cap");
      else if (validIds.length === 0) result = downgrade("no_valid_kb_ids");
      else if (!reply) return fail("bad_output", usage);
      else result = { ok: true, outcome: "diagnose", reply, kbIds: validIds, summary };
    } else {
      result = { ok: true, outcome, summary };
    }

    log.info("answered", {
      model_outcome: outcome,
      outcome: result.ok ? result.outcome : "",
      kb_ids: validIds.length,
      summary_chars: summary.length,
      ...(note ? { note } : {}),
      ...usage,
    });
    return result;
  };
}

export type Answerer = ReturnType<typeof createAnswerer>;
