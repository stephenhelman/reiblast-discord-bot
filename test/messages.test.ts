import { describe, expect, it } from "vitest";
import { createMessages, decideConfirm, decideStart } from "../src/verify/messages.js";
import type { ConfirmOutcome, StartOutcome } from "../src/server-client/types.js";

const PHONE = "+1 555 010 0000";
const m = createMessages(PHONE);

describe("refusals are indistinguishable", () => {
  const startRefusals: StartOutcome[] = (["not_eligible", "already_linked", "rate_limited", "delivery_failed"] as const).map(
    (reason) => ({ result: "refused", reason }),
  );
  const confirmRefusals: ConfirmOutcome[] = [
    { result: "refused", reason: "not_eligible" },
    { result: "refused", reason: "already_linked" },
    { result: "refused", reason: "rate_limited" },
  ];
  const all = [...startRefusals.map((o) => decideStart(o as StartOutcome, m)), ...confirmRefusals.map((o) => decideConfirm(o, m))];

  it("every refusal yields the byte-identical decision (text, button, session handling, no alert)", () => {
    const first = JSON.stringify(all[0]);
    for (const d of all) expect(JSON.stringify(d)).toBe(first);
    expect(all[0]).toEqual({ type: "reply", reply: { text: m.refusal }, session: "clear" });
  });

  it("the message mentions the support number and no button", () => {
    expect(m.refusal).toContain(PHONE);
    expect(m.refusal).toMatch(/double-check/i);
    expect(JSON.stringify(all[0])).not.toContain("enter_code");
  });

  it("never says which refusal happened", () => {
    expect(m.refusal).not.toMatch(/eligible|already|linked|limit|deliver|account exists/i);
  });
});

describe("invalid_code without attemptsRemaining (contract rule 3)", () => {
  it("is treated like code_expired: start-over message, session cleared, not the generic refusal", () => {
    const d = decideConfirm({ result: "refused", reason: "invalid_code" }, m);
    expect(d).toEqual({ type: "reply", reply: { text: m.startOver }, session: "clear" });
    expect(m.startOver).toMatch(/Verify buttons to start over/);
    expect(m.startOver).not.toBe(m.refusal);
  });
});

describe("decideStart", () => {
  it("code_sent shows only the last 4 digits, an Enter Code button, and starts a session", () => {
    const d = decideStart({ result: "code_sent", reason: "code_sent", phoneLast4: "1234" }, m);
    expect(d).toEqual({
      type: "reply",
      reply: { text: expect.stringContaining("phone ending in 1234"), button: "enter_code" },
      session: "start",
    });
  });

  it("linked skips to the rules step", () => {
    expect(decideStart({ result: "linked", reason: "linked" }, m)).toEqual({ type: "linked" });
  });

  it.each(["auth_missing", "auth_failed", "server_misconfigured", "bad_json", "bad_request"] as const)(
    "%s → generic try-later + staff alert",
    (reason) => {
      expect(decideStart({ result: "error", reason }, m)).toMatchObject({
        reply: { text: m.tryLater },
        alert: reason,
        session: "clear",
      });
    },
  );

  it("internal_error → try-later, no alert", () => {
    const d = decideStart({ result: "error", reason: "internal_error" }, m);
    expect(d).toMatchObject({ reply: { text: m.tryLater } });
    expect(d).not.toHaveProperty("alert");
  });
});

describe("decideConfirm", () => {
  it("linked → rules step", () => {
    expect(decideConfirm({ result: "linked", reason: "linked" }, m)).toEqual({ type: "linked" });
  });

  it("invalid_code with attempts says how many are left, offers Enter Code, keeps the session", () => {
    expect(decideConfirm({ result: "refused", reason: "invalid_code", attemptsRemaining: 2 }, m)).toEqual({
      type: "reply",
      reply: { text: "Incorrect code — 2 attempts left.", button: "enter_code" },
      session: "keep",
    });
    expect(decideConfirm({ result: "refused", reason: "invalid_code", attemptsRemaining: 1 }, m)).toMatchObject({
      reply: { text: "Incorrect code — 1 attempt left." },
    });
  });

  it("code_expired / code_locked tell the user to start over and clear the session", () => {
    expect(decideConfirm({ result: "refused", reason: "code_expired" }, m)).toEqual({
      type: "reply",
      reply: { text: m.codeExpired },
      session: "clear",
    });
    expect(decideConfirm({ result: "refused", reason: "code_locked" }, m)).toEqual({
      type: "reply",
      reply: { text: m.codeLocked },
      session: "clear",
    });
    expect(m.codeExpired).toMatch(/Verify/);
    expect(m.codeLocked).toMatch(/start over/);
  });

  it("errors: alerts for bugs, keeps the session so the user can retry", () => {
    expect(decideConfirm({ result: "error", reason: "auth_failed" }, m)).toMatchObject({
      reply: { text: m.tryLater },
      alert: "auth_failed",
      session: "keep",
    });
    const internal = decideConfirm({ result: "error", reason: "internal_error" }, m);
    expect(internal).toMatchObject({ session: "keep" });
    expect(internal).not.toHaveProperty("alert");
  });
});

describe("messages", () => {
  it("are frozen", () => {
    expect(Object.isFrozen(m)).toBe(true);
  });
});
