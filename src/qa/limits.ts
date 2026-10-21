export const RATE_MAX = 8;
export const RATE_WINDOW_MS = 10 * 60 * 1000;

export type RateResult =
  | { allowed: true }
  /** `notify` is true only for the first denial in a streak, so the caller can send one polite note per window. */
  | { allowed: false; notify: boolean; retryAfterMs: number };

interface Bucket {
  hits: number[];
  notified: boolean;
}

/** Per-user sliding window: at most `max` answered requests per `windowMs`. Denied requests don't count. */
export function createRateLimiter(opts: { max?: number; windowMs?: number; maxUsers?: number; now?: () => number } = {}) {
  const max = opts.max ?? RATE_MAX;
  const windowMs = opts.windowMs ?? RATE_WINDOW_MS;
  const maxUsers = opts.maxUsers ?? 10_000;
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  const sweep = (t: number) => {
    for (const [id, b] of buckets) {
      const newest = b.hits[b.hits.length - 1];
      if (newest === undefined || t - newest >= windowMs) buckets.delete(id);
    }
  };

  return {
    take(userId: string): RateResult {
      const t = now();
      if (buckets.size >= maxUsers && !buckets.has(userId)) sweep(t);
      let b = buckets.get(userId);
      if (!b) {
        b = { hits: [], notified: false };
        buckets.set(userId, b);
      }
      while (b.hits.length > 0 && t - b.hits[0]! >= windowMs) b.hits.shift();

      if (b.hits.length < max) {
        b.hits.push(t);
        b.notified = false;
        return { allowed: true };
      }
      const notify = !b.notified;
      b.notified = true;
      return { allowed: false, notify, retryAfterMs: b.hits[0]! + windowMs - t };
    },
    /** Tracked users, for tests. */
    size: () => buckets.size,
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

interface Slot {
  fn: () => Promise<void>;
  pending: boolean;
  done: Promise<void>;
}

/**
 * One run per key at a time. Triggers that arrive while a run is in flight are coalesced into a single follow-up run
 * (which sees everything posted since), using the most recent `fn`. The promise resolves when the run covering that
 * trigger has finished. Errors go to `onError`; the returned promise never rejects.
 */
export function createCoalescer(onError: (err: unknown) => void = () => {}) {
  const slots = new Map<string, Slot>();

  return function trigger(key: string, fn: () => Promise<void>): Promise<void> {
    const existing = slots.get(key);
    if (existing) {
      existing.fn = fn;
      existing.pending = true;
      return existing.done;
    }
    const slot: Slot = { fn, pending: false, done: Promise.resolve() };
    // Registered before the first run starts: a run that finishes without awaiting must still find its slot to delete.
    slots.set(key, slot);
    slot.done = (async () => {
      do {
        slot.pending = false;
        try {
          await slot.fn();
        } catch (err) {
          onError(err);
        }
      } while (slot.pending);
      slots.delete(key);
    })();
    return slot.done;
  };
}

export type Coalescer = ReturnType<typeof createCoalescer>;
