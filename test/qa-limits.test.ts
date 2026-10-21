import { describe, expect, it } from "vitest";
import { createCoalescer, createRateLimiter, RATE_MAX, RATE_WINDOW_MS } from "../src/qa/limits.js";
import { createThreadStateStore } from "../src/qa/state.js";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("rate limiter", () => {
  it("defaults to 8 per 10 minutes", () => {
    expect(RATE_MAX).toBe(8);
    expect(RATE_WINDOW_MS).toBe(600_000);
  });

  it("allows up to the max, then denies", () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now });
    for (let i = 0; i < RATE_MAX; i++) expect(rl.take("u1")).toEqual({ allowed: true });
    expect(rl.take("u1")).toMatchObject({ allowed: false });
  });

  it("asks the caller to notify only once per denial streak", () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now });
    for (let i = 0; i < RATE_MAX; i++) rl.take("u1");
    expect(rl.take("u1")).toMatchObject({ allowed: false, notify: true });
    expect(rl.take("u1")).toMatchObject({ allowed: false, notify: false });
    expect(rl.take("u1")).toMatchObject({ allowed: false, notify: false });
  });

  it("allows again after the window and re-arms the notice", () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now });
    for (let i = 0; i < RATE_MAX; i++) rl.take("u1");
    rl.take("u1");
    c.advance(RATE_WINDOW_MS);
    expect(rl.take("u1")).toEqual({ allowed: true });
    for (let i = 0; i < RATE_MAX - 1; i++) rl.take("u1");
    expect(rl.take("u1")).toMatchObject({ allowed: false, notify: true });
  });

  it("slides: old hits expire one by one", () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now, max: 2, windowMs: 1000 });
    rl.take("u"); // t=0
    c.advance(600);
    rl.take("u"); // t=600
    expect(rl.take("u")).toMatchObject({ allowed: false });
    c.advance(401); // t=1001: the first hit expired, the second hasn't
    expect(rl.take("u")).toEqual({ allowed: true });
    expect(rl.take("u")).toMatchObject({ allowed: false });
  });

  it("denied requests don't extend the block, and retryAfter counts down to the oldest hit", () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now, max: 1, windowMs: 1000 });
    rl.take("u");
    c.advance(300);
    const r = rl.take("u");
    expect(r).toMatchObject({ allowed: false, retryAfterMs: 700 });
    c.advance(700);
    expect(rl.take("u")).toEqual({ allowed: true });
  });

  it("tracks users independently", () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now, max: 1 });
    expect(rl.take("a")).toEqual({ allowed: true });
    expect(rl.take("b")).toEqual({ allowed: true });
    expect(rl.take("a")).toMatchObject({ allowed: false });
  });

  it("sweeps expired users when the table is full", () => {
    const c = clock();
    const rl = createRateLimiter({ now: c.now, windowMs: 1000, maxUsers: 3 });
    ["a", "b", "c"].forEach((u) => rl.take(u));
    c.advance(1000);
    rl.take("d");
    expect(rl.size()).toBe(1);
  });
});

describe("coalescer", () => {
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  it("runs triggers for one key one at a time and folds mid-run triggers into a single follow-up using the latest fn", async () => {
    const trigger = createCoalescer();
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const first = trigger("t", async () => {
      log.push("first:start");
      await gate;
      log.push("first:end");
    });
    await tick();
    const p2 = trigger("t", async () => void log.push("second"));
    const p3 = trigger("t", async () => void log.push("third"));
    const p4 = trigger("t", async () => void log.push("fourth"));
    release();
    await Promise.all([first, p2, p3, p4]);

    expect(log).toEqual(["first:start", "first:end", "fourth"]);
  });

  it("resolves a coalesced trigger's promise only after the follow-up run finished", async () => {
    const trigger = createCoalescer();
    let followUpDone = false;
    const first = trigger("t", async () => {
      await tick();
    });
    const second = trigger("t", async () => {
      await tick();
      followUpDone = true;
    });
    await second;
    expect(followUpDone).toBe(true);
    await first;
  });

  it("runs different keys concurrently", async () => {
    const trigger = createCoalescer();
    const running = new Set<string>();
    let max = 0;
    const job = (k: string) => async () => {
      running.add(k);
      max = Math.max(max, running.size);
      await tick();
      running.delete(k);
    };
    await Promise.all([trigger("a", job("a")), trigger("b", job("b"))]);
    expect(max).toBe(2);
  });

  it("starts fresh after a run completes", async () => {
    const trigger = createCoalescer();
    const log: string[] = [];
    await trigger("t", async () => void log.push("one"));
    await trigger("t", async () => void log.push("two"));
    expect(log).toEqual(["one", "two"]);
  });

  it("reports errors, never rejects, and frees the slot (async and synchronous throws)", async () => {
    const errors: unknown[] = [];
    const trigger = createCoalescer((e) => errors.push(e));
    await expect(trigger("t", async () => Promise.reject(new Error("boom")))).resolves.toBeUndefined();
    await expect(trigger("t", (() => {
      throw new Error("sync");
    }) as () => Promise<void>)).resolves.toBeUndefined();
    const log: string[] = [];
    await trigger("t", async () => void log.push("ok"));
    expect(errors).toHaveLength(2);
    expect(log).toEqual(["ok"]);
  });

  it("still runs the follow-up after the in-flight run fails", async () => {
    const trigger = createCoalescer();
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = trigger("t", async () => {
      await gate;
      throw new Error("boom");
    });
    await tick();
    const second = trigger("t", async () => void log.push("follow-up"));
    release();
    await Promise.all([first, second]);
    expect(log).toEqual(["follow-up"]);
  });
});

describe("thread state store", () => {
  it("counts bot posts and remembers the last outcome", () => {
    const s = createThreadStateStore();
    expect(s.get("t")).toBeUndefined();
    s.recordPost("t", "answered");
    s.recordPost("t", "clarify");
    expect(s.get("t")).toEqual({ botTurns: 2, last: "clarify" });
    expect(s.priorClarify("t")).toBe(true);
    s.recordPost("t", "answered");
    expect(s.priorClarify("t")).toBe(false);
    expect(s.priorClarify("unknown")).toBe(false);
  });

  it("seeds a count from a re-counted thread without losing the last outcome", () => {
    const s = createThreadStateStore();
    s.seed("t", 3);
    expect(s.get("t")).toEqual({ botTurns: 3, last: "other" });
    s.recordPost("t", "clarify");
    s.seed("t", 4);
    expect(s.get("t")).toEqual({ botTurns: 4, last: "clarify" });
  });

  it("evicts the least recently used thread", () => {
    const s = createThreadStateStore({ max: 2 });
    s.recordPost("a", "answered");
    s.recordPost("b", "answered");
    s.recordPost("a", "answered"); // a is now most recent
    s.recordPost("c", "answered");
    expect(s.get("b")).toBeUndefined();
    expect(s.get("a")).toBeDefined();
    expect(s.size()).toBe(2);
  });
});
