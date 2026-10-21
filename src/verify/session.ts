import type { Identifier } from "../server-client/types.js";

export const SESSION_TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

export interface SessionStore {
  /** Remember the identifier for a user whose start just returned code_sent. Overwrites any previous one. */
  begin(userId: string, identifier: Identifier): void;
  /** The identifier from the last code_sent, or undefined if none / expired. */
  pending(userId: string): Identifier | undefined;
  clearPending(userId: string): void;
  /** The server confirmed the link: allow the "I agree" step for a while. Also drops the pending session. */
  markVerified(userId: string): void;
  isVerified(userId: string): boolean;
  clearVerified(userId: string): void;
  /** Drops expired entries; returns how many. */
  sweep(): number;
  size(): number;
  start(): void;
  stop(): void;
}

interface Options {
  ttlMs?: number;
  now?: () => number;
  sweepIntervalMs?: number;
}

/**
 * In-memory only, keyed by Discord user ID. A restart mid-flow just means the user starts over.
 * Expiry is enforced on read; the sweep timer only reclaims memory.
 */
export function createSessionStore(opts: Options = {}): SessionStore {
  const ttl = opts.ttlMs ?? SESSION_TTL_MS;
  const now = opts.now ?? Date.now;
  const interval = opts.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
  const pending = new Map<string, { identifier: Identifier; expiresAt: number }>();
  const verified = new Map<string, number>();
  let timer: NodeJS.Timeout | undefined;

  const sweep = (): number => {
    const t = now();
    let removed = 0;
    for (const [k, v] of pending) if (v.expiresAt <= t) (pending.delete(k), removed++);
    for (const [k, exp] of verified) if (exp <= t) (verified.delete(k), removed++);
    return removed;
  };

  return {
    begin: (userId, identifier) => void pending.set(userId, { identifier, expiresAt: now() + ttl }),
    pending(userId) {
      const s = pending.get(userId);
      if (!s) return undefined;
      if (s.expiresAt <= now()) {
        pending.delete(userId);
        return undefined;
      }
      return s.identifier;
    },
    clearPending: (userId) => void pending.delete(userId),
    markVerified(userId) {
      pending.delete(userId);
      verified.set(userId, now() + ttl);
    },
    isVerified(userId) {
      const exp = verified.get(userId);
      if (exp === undefined) return false;
      if (exp <= now()) {
        verified.delete(userId);
        return false;
      }
      return true;
    },
    clearVerified: (userId) => void verified.delete(userId),
    sweep,
    size: () => pending.size + verified.size,
    start() {
      if (timer) return;
      timer = setInterval(sweep, interval);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
