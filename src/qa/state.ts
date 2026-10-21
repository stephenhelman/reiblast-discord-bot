import type { Outcome } from "./schema.js";

export interface ThreadState {
  /** Messages the bot has posted in the thread. */
  botTurns: number;
  /** What the bot's most recent post was. */
  last: Outcome | "other";
  /** The model's latest case summary (sanitised, plain text), kept in memory only, for a hand-off from a button or the turn cap. */
  summary?: string;
}

/**
 * Small in-memory cache of per-thread facts so most events decide without fetching history. Losing it (restart,
 * eviction) is safe: decide() asks for history, and botTurns and the question counts are re-derived from the thread. Holds
 * counts, an outcome label, and the latest case summary (model-written, sanitised) — never a member's message text, and
 * nothing here is ever logged.
 */
export function createThreadStateStore(opts: { max?: number } = {}) {
  const max = opts.max ?? 5_000;
  const states = new Map<string, ThreadState>();

  const touch = (threadId: string, s: ThreadState) => {
    states.delete(threadId); // re-insert so Map order is recency order
    states.set(threadId, s);
    if (states.size > max) {
      const oldest = states.keys().next().value;
      if (oldest !== undefined) states.delete(oldest);
    }
  };

  return {
    get: (threadId: string): ThreadState | undefined => states.get(threadId),
    /** Record that the bot posted in the thread. */
    recordPost(threadId: string, last: ThreadState["last"]): void {
      const prev = states.get(threadId);
      touch(threadId, { botTurns: (prev?.botTurns ?? 0) + 1, last, summary: prev?.summary });
    },
    /** Set the count after re-counting from a fetched thread. `last` is kept if known, otherwise "other". */
    seed(threadId: string, botTurns: number): void {
      const prev = states.get(threadId);
      touch(threadId, { botTurns, last: prev?.last ?? "other", summary: prev?.summary });
    },
    /** Remember the latest case summary for the thread (an empty summary clears it). */
    setSummary(threadId: string, summary: string): void {
      const prev = states.get(threadId);
      touch(threadId, { botTurns: prev?.botTurns ?? 0, last: prev?.last ?? "other", summary: summary || undefined });
    },
    getSummary: (threadId: string): string | undefined => states.get(threadId)?.summary,
    size: () => states.size,
  };
}

export type ThreadStateStore = ReturnType<typeof createThreadStateStore>;
