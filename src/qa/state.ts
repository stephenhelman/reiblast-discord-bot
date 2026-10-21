import type { Outcome } from "./schema.js";

export interface ThreadState {
  /** Messages the bot has posted in the thread. */
  botTurns: number;
  /** What the bot's most recent post was. */
  last: Outcome | "other";
}

/**
 * Small in-memory cache of per-thread facts so most events decide without fetching history. Losing it (restart,
 * eviction) is safe: decide() asks for history, and botTurns is re-counted from the thread. Holds counts and an outcome
 * label only — never message text.
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
      touch(threadId, { botTurns: (states.get(threadId)?.botTurns ?? 0) + 1, last });
    },
    /** Set the count after re-counting from a fetched thread. `last` is kept if known, otherwise "other". */
    seed(threadId: string, botTurns: number): void {
      touch(threadId, { botTurns, last: states.get(threadId)?.last ?? "other" });
    },
    /** The bot's previous post was a clarifying question (so a second one must escalate). */
    priorClarify: (threadId: string): boolean => states.get(threadId)?.last === "clarify",
    size: () => states.size,
  };
}

export type ThreadStateStore = ReturnType<typeof createThreadStateStore>;
