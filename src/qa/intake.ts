/**
 * Escalation intake: for a hand-off from a troubleshooting thread (any diagnose question was asked), staff get the case
 * summary and the member gets a fixed ask for the details staff will need. This module decides whether a thread is a
 * troubleshooting thread and finds its summary. Plain questions with no diagnose turns get neither.
 *
 * Where the summary comes from, in order: the model call that just happened (not_covered / account_specific), the latest
 * one remembered in memory (a button click, the turn cap), or — after a restart wiped the memory — one extra model call
 * made from the thread's history. If that fails the hand-off goes ahead without a summary (code summary_unavailable).
 */
import { createLogger, type Logger } from "../logger.js";
import type { Answerer } from "./answer.js";
import type { ThreadLike } from "./buttons.js";
import { buildThreadHistory, type ThreadMessage } from "./history.js";
import { parseMarker } from "./markers.js";
import { MAX_DIAGNOSE } from "./progress.js";
import type { ThreadStateStore } from "./state.js";

export interface IntakeContext {
  /** Any diagnose question was asked in this thread. */
  troubleshooting: boolean;
  /** Sanitised case summary, if one could be found. Only present for troubleshooting threads. */
  summary?: string;
}

export interface IntakeKnown {
  /** The thread's messages, oldest first, if the caller already fetched them. */
  messages?: readonly ThreadMessage[];
  /** Diagnose questions in the thread, if the caller already derived it from history. */
  diagnoseTurns?: number;
  /** The summary from the model call that just happened. */
  summary?: string;
  /** False when the model is failing (an extra call would only fail too). Default true. */
  allowRegenerate?: boolean;
}

export type Summarizer = (turns: Parameters<Answerer>[0]["history"]) => Promise<{ ok: true; summary: string } | { ok: false }>;

/**
 * An extra model call that only wants the summary. It goes through the normal answerer — same cached system prompt, same
 * schema — with the question caps already reached so it can't ask anything; whatever else the model returns is ignored.
 */
export function createSummarizer(answer: Answerer): Summarizer {
  return async (history) => {
    const turns = [...history];
    while (turns.at(-1)?.role === "assistant") turns.pop(); // the model needs the member's last words to end on
    if (turns.length === 0) return { ok: false };
    const result = await answer({ history: turns, surface: "forum", progress: { diagnoseAsked: MAX_DIAGNOSE, clarifyUsed: true } });
    return result.ok && result.summary ? { ok: true, summary: result.summary } : { ok: false };
  };
}

export function countDiagnoseTurns(messages: readonly ThreadMessage[], botId: string): number {
  return messages.filter((m) => !m.system && m.authorId === botId && parseMarker(m.content)?.kind === "diagnose").length;
}

export function createIntake(opts: {
  state: Pick<ThreadStateStore, "getSummary">;
  summarize: Summarizer;
  botId: string;
  fetchMessages: (thread: ThreadLike) => Promise<ThreadMessage[]>;
  logger?: Logger;
}) {
  const log = opts.logger ?? createLogger("intake");

  return {
    async contextFor(thread: ThreadLike, known: IntakeKnown = {}): Promise<IntakeContext> {
      let messages = known.messages;
      const load = async (): Promise<readonly ThreadMessage[] | undefined> => {
        if (messages) return messages;
        try {
          messages = await opts.fetchMessages(thread);
        } catch {
          log.warn("thread history not available", { code: "intake_fetch_failed" });
        }
        return messages;
      };

      let diagnoseTurns = known.diagnoseTurns;
      if (diagnoseTurns === undefined) {
        const loaded = await load();
        if (!loaded) return { troubleshooting: false };
        diagnoseTurns = countDiagnoseTurns(loaded, opts.botId);
      }
      if (diagnoseTurns === 0) return { troubleshooting: false };

      const summary = known.summary?.trim() || opts.state.getSummary(thread.id);
      if (summary) return { troubleshooting: true, summary };

      // Nothing remembered (a restart, or eviction): one extra call from the thread's history.
      if (known.allowRegenerate !== false) {
        const loaded = await load();
        const lastFromPoster = loaded?.filter((m) => !m.system && m.authorId !== opts.botId && m.authorId === thread.ownerId).at(-1);
        if (loaded && lastFromPoster) {
          const { turns } = buildThreadHistory(loaded, {
            botId: opts.botId,
            opId: thread.ownerId ?? "",
            threadId: thread.id,
            title: thread.name,
            trigger: lastFromPoster,
          });
          const regenerated = await opts.summarize(turns).catch(() => ({ ok: false as const }));
          if (regenerated.ok) return { troubleshooting: true, summary: regenerated.summary };
        }
      }
      log.warn("case summary not available", { code: "summary_unavailable" });
      return { troubleshooting: true };
    },
  };
}

export type Intake = ReturnType<typeof createIntake>;
