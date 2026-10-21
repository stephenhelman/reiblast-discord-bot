import Anthropic from "@anthropic-ai/sdk";
import type { Kb } from "../kb/load.js";
import { createLogger, type Logger } from "../logger.js";
import { buildMessages, buildSystem, type HistoryTurn, type Surface } from "./prompt.js";
import { ANSWER_JSON_SCHEMA, modelAnswerSchema } from "./schema.js";

export const MODEL = "claude-haiku-5-5";
export const TIMEOUT_MS = 20_000;
/** Thinking counts toward max_tokens on Haiku 5.5, so this leaves room for it plus a ~1,200-char reply. */
export const MAX_TOKENS = 1024;

/** Why no usable answer came back. Callers treat every one of these like not_covered (never post model text). */
export type QaFailure = "api_error" | "timeout" | "refusal" | "max_tokens" | "bad_output";

/** A guardrail changed what the model said. Logged as a reason code. */
export type AnswerNote = "no_valid_kb_ids" | "repeat_clarify";

export type AnswerResult =
  | { ok: true; outcome: "answered"; reply: string; kbIds: string[] }
  | { ok: true; outcome: "clarify"; reply: string }
  /** No model text is carried: the caller posts its fixed template. */
  | { ok: true; outcome: "not_covered" | "account_specific"; note?: AnswerNote }
  | { ok: false; reason: QaFailure };

export interface AnswerInput {
  /** Thread history, oldest first, ending with the member's new message. */
  history: readonly HistoryTurn[];
  /** Where the reply will be posted; shapes the closing pointer. */
  surface: Surface;
  /** The bot's previous turn in this thread was a clarifying question. */
  priorClarify?: boolean;
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
    const messages = buildMessages(input.history, input.surface);

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
    const { outcome, reply } = parsed.data;

    let result: AnswerResult;
    let note: AnswerNote | undefined;
    let validIds = 0;

    if (outcome === "answered") {
      const ids = [...new Set(parsed.data.kbIds)].filter((id) => kb.ids.has(id));
      validIds = ids.length;
      if (ids.length === 0) {
        // An answer that cites nothing real is a guess by another name.
        note = "no_valid_kb_ids";
        result = { ok: true, outcome: "not_covered", note };
      } else if (!reply.trim()) {
        return fail("bad_output", usage);
      } else {
        result = { ok: true, outcome: "answered", reply: reply.trim(), kbIds: ids };
      }
    } else if (outcome === "clarify") {
      if (input.priorClarify) {
        note = "repeat_clarify";
        result = { ok: true, outcome: "not_covered", note };
      } else if (!reply.trim()) {
        return fail("bad_output", usage);
      } else {
        result = { ok: true, outcome: "clarify", reply: reply.trim() };
      }
    } else {
      result = { ok: true, outcome };
    }

    log.info("answered", { model_outcome: outcome, outcome: result.ok ? result.outcome : "", kb_ids: validIds, ...(note ? { note } : {}), ...usage });
    return result;
  };
}

export type Answerer = ReturnType<typeof createAnswerer>;
