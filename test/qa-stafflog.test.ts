import { describe, expect, it, vi } from "vitest";
import { createStaffLog } from "../src/qa/stafflog.js";
import type { Logger } from "../src/logger.js";

const POST = "https://discord.com/channels/1/900";
const PRIV = "https://discord.com/channels/1/800";
const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function setup(write: (t: string) => Promise<void> = async () => {}) {
  const w = vi.fn(write);
  return { w, log: createStaffLog({ write: w, logger: quiet }) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("staff log lines", () => {
  it("formats each escalation as a reason code and unfurl-suppressed links, nothing else", async () => {
    const { w, log } = setup();
    log.needsStaff("not_covered", POST);
    log.privateThread("account_specific", POST, PRIV);
    log.movedToPrivate(POST, PRIV);
    log.closed(PRIV);
    await flush();
    expect(w.mock.calls.map((c) => c[0])).toEqual([
      `📣 Needs Staff · not_covered · <${POST}>`,
      `🔒 Private thread · account_specific · <${POST}> → <${PRIV}>`,
      `🔒 Moved to private by staff · <${POST}> → <${PRIV}>`,
      `✅ Private thread closed · <${PRIV}>`,
    ]);
  });

  it("never throws or rejects when the log channel is unavailable (async or sync failure)", async () => {
    const failing = setup(async () => Promise.reject(new Error("Missing Access")));
    expect(() => failing.log.needsStaff("x", POST)).not.toThrow();
    const throwing = createStaffLog({
      write: (() => {
        throw new Error("sync");
      }) as (t: string) => Promise<void>,
      logger: quiet,
    });
    expect(() => throwing.closed(PRIV)).not.toThrow();
    await flush();
  });
});
