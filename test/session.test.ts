import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionStore, SESSION_TTL_MS } from "../src/verify/session.js";

const email = { kind: "email", value: "member@example.com" } as const;
const loc = { kind: "locationId", value: "loc_abc123" } as const;

function store() {
  let t = 1_000_000;
  const s = createSessionStore({ now: () => t });
  return { s, advance: (ms: number) => (t += ms) };
}

afterEach(() => vi.restoreAllMocks());

describe("pending session", () => {
  it("is absent until begin, then returns the identifier", () => {
    const { s } = store();
    expect(s.pending("u1")).toBeUndefined();
    s.begin("u1", email);
    expect(s.pending("u1")).toEqual(email);
  });

  it("is keyed per user", () => {
    const { s } = store();
    s.begin("u1", email);
    expect(s.pending("u2")).toBeUndefined();
  });

  it("a new begin overwrites the previous identifier and restarts the clock", () => {
    const { s, advance } = store();
    s.begin("u1", email);
    advance(SESSION_TTL_MS - 1000);
    s.begin("u1", loc);
    advance(5000);
    expect(s.pending("u1")).toEqual(loc);
  });

  it("expires after 10 minutes (lazily, on read)", () => {
    const { s, advance } = store();
    s.begin("u1", email);
    advance(SESSION_TTL_MS - 1);
    expect(s.pending("u1")).toEqual(email);
    advance(1);
    expect(s.pending("u1")).toBeUndefined();
    expect(s.size()).toBe(0);
  });

  it("clearPending removes it", () => {
    const { s } = store();
    s.begin("u1", email);
    s.clearPending("u1");
    expect(s.pending("u1")).toBeUndefined();
  });
});

describe("verified flag", () => {
  it("markVerified sets the flag and drops the pending session", () => {
    const { s } = store();
    s.begin("u1", email);
    s.markVerified("u1");
    expect(s.isVerified("u1")).toBe(true);
    expect(s.pending("u1")).toBeUndefined();
  });

  it("is false for users who never verified", () => {
    expect(store().s.isVerified("nobody")).toBe(false);
  });

  it("expires after 10 minutes", () => {
    const { s, advance } = store();
    s.markVerified("u1");
    advance(SESSION_TTL_MS - 1);
    expect(s.isVerified("u1")).toBe(true);
    advance(1);
    expect(s.isVerified("u1")).toBe(false);
  });

  it("clearVerified removes it", () => {
    const { s } = store();
    s.markVerified("u1");
    s.clearVerified("u1");
    expect(s.isVerified("u1")).toBe(false);
  });
});

describe("sweep and timer", () => {
  it("sweep removes only expired entries and reports the count", () => {
    const { s, advance } = store();
    s.begin("old", email);
    s.markVerified("oldv");
    advance(SESSION_TTL_MS - 10);
    s.begin("new", loc);
    advance(10);
    expect(s.sweep()).toBe(2);
    expect(s.size()).toBe(1);
    expect(s.pending("new")).toEqual(loc);
  });

  it("the sweep timer is unref'd and stop() clears it", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const s = createSessionStore();
    s.start();
    const handle = spy.mock.results[0]!.value as NodeJS.Timeout;
    expect(handle.hasRef()).toBe(false);
    s.start(); // idempotent
    expect(spy).toHaveBeenCalledTimes(1);
    const clear = vi.spyOn(globalThis, "clearInterval");
    s.stop();
    expect(clear).toHaveBeenCalledWith(handle);
  });

  it("the timer actually sweeps", () => {
    vi.useFakeTimers();
    try {
      let t = 0;
      const s = createSessionStore({ now: () => t, sweepIntervalMs: 1000 });
      s.start();
      s.begin("u1", email);
      t = SESSION_TTL_MS + 1;
      vi.advanceTimersByTime(1000);
      expect(s.size()).toBe(0);
      s.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
