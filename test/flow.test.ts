import { MessageFlags, type ModalBuilder } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GrantResult } from "../src/roles/grant.js";
import type { ConfirmOutcome, ServerClient, StartOutcome } from "../src/server-client/types.js";
import { createVerifyFlow, type ReplyPayload } from "../src/verify/flow.js";
import { IDS } from "../src/verify/ids.js";
import { createMessages } from "../src/verify/messages.js";
import { createSessionStore } from "../src/verify/session.js";
import { buildPanelMessage } from "../src/verify/components.js";
import type { Logger } from "../src/logger.js";

const PHONE = "+1 555 010 0000";
const m = createMessages(PHONE);
const USER = "123456789012345678";
const EMAIL = "member@example.com";
const quietLog: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const START_CODE_SENT: StartOutcome = { result: "code_sent", reason: "code_sent", phoneLast4: "1234" };

interface Calls {
  order: string[];
  deferred: boolean;
  edits: ReplyPayload[];
}

function modal(fields: Record<string, string>, calls: Calls, userId = USER) {
  return {
    user: { id: userId },
    fields: { getTextInputValue: (id: string) => fields[id] ?? "" },
    deferReply: vi.fn(async (o: unknown) => {
      calls.order.push("defer");
      calls.deferred = true;
      expect(o).toEqual({ flags: MessageFlags.Ephemeral });
    }),
    editReply: vi.fn(async (p: ReplyPayload) => {
      calls.order.push("edit");
      calls.edits.push(p);
    }),
  };
}
const newCalls = (): Calls => ({ order: [], deferred: false, edits: [] });

function buttonIds(p: ReplyPayload): string[] {
  return (p.components ?? []).flatMap((row) => row.toJSON().components.map((c) => ("custom_id" in c ? String(c.custom_id) : "")));
}

function setup(over: { start?: StartOutcome; confirm?: ConfirmOutcome; grant?: GrantResult | Error } = {}) {
  const calls = newCalls();
  const sessions = createSessionStore();
  const serverClient = {
    verifyStart: vi.fn(async () => {
      calls.order.push("server");
      return over.start ?? START_CODE_SENT;
    }),
    verifyConfirm: vi.fn(async () => over.confirm ?? ({ result: "linked", reason: "linked" } as ConfirmOutcome)),
  } satisfies ServerClient;
  const grantRole = vi.fn(async (): Promise<GrantResult> => {
    if (over.grant instanceof Error) throw over.grant;
    return over.grant ?? { status: "granted" };
  });
  const alert = vi.fn();
  const flow = createVerifyFlow({
    serverClient,
    sessions,
    rules: ["rule one", "rule two"],
    supportPhone: PHONE,
    grantRole,
    alert,
    logger: quietLog,
  });
  return { flow, sessions, serverClient, grantRole, alert, calls };
}

const emailModal = (calls: Calls, value = EMAIL) => modal({ [IDS.fieldIdentifier]: value }, calls);
const codeModal = (calls: Calls, value = "123456") => modal({ [IDS.fieldCode]: value }, calls);

describe("start (identifier modal)", () => {
  it("defers ephemerally BEFORE calling the server, then edits once", async () => {
    const { flow, serverClient, calls } = setup();
    await flow.handleIdentifierModal(emailModal(calls), "email");
    expect(calls.order).toEqual(["defer", "server", "edit"]);
    expect(serverClient.verifyStart).toHaveBeenCalledWith(USER, { kind: "email", value: EMAIL });
  });

  it("code_sent: shows last 4 + Enter Code, remembers the identifier, never echoes the email", async () => {
    const { flow, sessions, calls } = setup();
    await flow.handleIdentifierModal(emailModal(calls), "email");
    const edit = calls.edits[0]!;
    expect(edit.content).toContain("phone ending in 1234");
    expect(buttonIds(edit)).toEqual([IDS.buttonEnterCode]);
    expect(JSON.stringify(edit)).not.toContain(EMAIL);
    expect(sessions.pending(USER)).toEqual({ kind: "email", value: EMAIL });
  });

  it("location ID path sends kind locationId", async () => {
    const { flow, serverClient, calls } = setup();
    await flow.handleIdentifierModal(modal({ [IDS.fieldIdentifier]: "loc_abc123" }, calls), "locationId");
    expect(serverClient.verifyStart).toHaveBeenCalledWith(USER, { kind: "locationId", value: "loc_abc123" });
  });

  it("linked from start skips straight to rules + I agree, and sets the verified flag", async () => {
    const { flow, sessions, calls } = setup({ start: { result: "linked", reason: "linked" } });
    await flow.handleIdentifierModal(emailModal(calls), "email");
    const edit = calls.edits[0]!;
    expect(edit.content).toBe(m.rulesIntro);
    expect(edit.embeds).toHaveLength(2);
    expect(buttonIds(edit)).toEqual([IDS.buttonAgree]);
    expect(sessions.isVerified(USER)).toBe(true);
    expect(sessions.pending(USER)).toBeUndefined();
  });

  it("every refusal reason produces a byte-identical edit through the same path", async () => {
    const reasons = ["not_eligible", "already_linked", "rate_limited", "delivery_failed"] as const;
    const edits: string[] = [];
    for (const reason of reasons) {
      const { flow, sessions, calls, alert } = setup({ start: { result: "refused", reason } });
      await flow.handleIdentifierModal(emailModal(calls), "email");
      edits.push(JSON.stringify(calls.edits));
      expect(calls.edits).toHaveLength(1);
      expect(sessions.pending(USER)).toBeUndefined(); // no session on a refusal
      expect(alert).not.toHaveBeenCalled();
    }
    expect(new Set(edits).size).toBe(1);
    expect(JSON.parse(edits[0]!)[0].content).toBe(m.refusal);
  });

  it("a refused start drops any earlier pending session for that user", async () => {
    const { flow, sessions, calls } = setup({ start: { result: "refused", reason: "rate_limited" } });
    sessions.begin(USER, { kind: "email", value: "old@example.com" });
    await flow.handleIdentifierModal(emailModal(calls), "email");
    expect(sessions.pending(USER)).toBeUndefined();
  });

  it("malformed input never reaches the server", async () => {
    const { flow, serverClient, calls } = setup();
    await flow.handleIdentifierModal(emailModal(calls, "not-an-email"), "email");
    await flow.handleIdentifierModal(modal({ [IDS.fieldIdentifier]: "a b" }, newCalls()), "locationId");
    expect(serverClient.verifyStart).not.toHaveBeenCalled();
    expect(calls.edits[0]!.content).toBe(m.badEmail);
  });

  it("bug-class server errors show try-later and alert staff with the reason code only", async () => {
    const { flow, calls, alert } = setup({ start: { result: "error", reason: "auth_failed" } });
    await flow.handleIdentifierModal(emailModal(calls), "email");
    expect(calls.edits[0]!.content).toBe(m.tryLater);
    expect(alert).toHaveBeenCalledWith("auth_failed");
  });
});

describe("confirm (code modal)", () => {
  async function withSession(over: Parameters<typeof setup>[0] = {}) {
    const s = setup(over);
    s.sessions.begin(USER, { kind: "email", value: EMAIL });
    return s;
  }

  it("refuses without a live session: start-over message, no server call", async () => {
    const { flow, serverClient, calls } = setup();
    await flow.handleCodeModal(codeModal(calls));
    expect(calls.edits[0]!.content).toBe(m.startOver);
    expect(serverClient.verifyConfirm).not.toHaveBeenCalled();
  });

  it("refuses after the session expires", async () => {
    let t = 0;
    const calls = newCalls();
    const sessions = createSessionStore({ now: () => t });
    const verifyConfirm = vi.fn();
    const flow = createVerifyFlow({
      serverClient: { verifyStart: vi.fn(), verifyConfirm },
      sessions,
      rules: ["r"],
      supportPhone: PHONE,
      grantRole: vi.fn(),
      alert: vi.fn(),
      logger: quietLog,
    });
    sessions.begin(USER, { kind: "email", value: EMAIL });
    t = 10 * 60 * 1000 + 1;
    await flow.handleCodeModal(codeModal(calls));
    expect(calls.edits[0]!.content).toBe(m.startOver);
    expect(verifyConfirm).not.toHaveBeenCalled();
  });

  it("reuses the identifier from the start call and defers first", async () => {
    const { flow, serverClient, calls } = await withSession();
    await flow.handleCodeModal(codeModal(calls));
    expect(serverClient.verifyConfirm).toHaveBeenCalledWith(USER, { kind: "email", value: EMAIL }, "123456");
    expect(calls.order).toEqual(["defer", "edit"]);
  });

  it("rejects a non-6-digit code locally without calling the server, keeping the session", async () => {
    const { flow, serverClient, sessions, calls } = await withSession();
    await flow.handleCodeModal(codeModal(calls, "12ab"));
    expect(serverClient.verifyConfirm).not.toHaveBeenCalled();
    expect(calls.edits[0]!.content).toBe(m.badCode);
    expect(sessions.pending(USER)).toBeDefined();
  });

  it("linked → rules + I agree, verified flag set, pending dropped", async () => {
    const { flow, sessions, calls } = await withSession();
    await flow.handleCodeModal(codeModal(calls));
    expect(buttonIds(calls.edits[0]!)).toEqual([IDS.buttonAgree]);
    expect(sessions.isVerified(USER)).toBe(true);
    expect(sessions.pending(USER)).toBeUndefined();
  });

  it("invalid_code with attemptsRemaining keeps the session and offers Enter Code again", async () => {
    const { flow, sessions, calls } = await withSession({
      confirm: { result: "refused", reason: "invalid_code", attemptsRemaining: 2 },
    });
    await flow.handleCodeModal(codeModal(calls));
    expect(calls.edits[0]!.content).toBe("Incorrect code — 2 attempts left.");
    expect(buttonIds(calls.edits[0]!)).toEqual([IDS.buttonEnterCode]);
    expect(sessions.pending(USER)).toBeDefined();
  });

  it.each([
    [{ result: "refused", reason: "code_expired" }],
    [{ result: "refused", reason: "code_locked" }],
    [{ result: "refused", reason: "already_linked" }],
    [{ result: "refused", reason: "not_eligible" }],
    [{ result: "refused", reason: "rate_limited" }],
    [{ result: "refused", reason: "invalid_code" }],
  ] as [ConfirmOutcome][])("%j deletes the session", async (confirm) => {
    const { flow, sessions, calls } = await withSession({ confirm });
    await flow.handleCodeModal(codeModal(calls));
    expect(sessions.pending(USER)).toBeUndefined();
  });

  it("invalid_code without attemptsRemaining shows the start-over message and deletes the session", async () => {
    const { flow, sessions, calls } = await withSession({ confirm: { result: "refused", reason: "invalid_code" } });
    await flow.handleCodeModal(codeModal(calls));
    expect(calls.edits[0]!.content).toBe(m.startOver);
    expect(buttonIds(calls.edits[0]!)).toEqual([]);
    expect(sessions.pending(USER)).toBeUndefined();
  });

  it("already_linked / not_eligible / rate_limited are byte-identical to start refusals", async () => {
    const start = setup({ start: { result: "refused", reason: "not_eligible" } });
    await start.flow.handleIdentifierModal(emailModal(start.calls), "email");
    const expected = JSON.stringify(start.calls.edits);
    for (const reason of ["already_linked", "not_eligible", "rate_limited"] as const) {
      const s = await withSession({ confirm: { result: "refused", reason } });
      await s.flow.handleCodeModal(codeModal(s.calls));
      expect(JSON.stringify(s.calls.edits)).toBe(expected);
    }
  });

  it("an internal server error keeps the session so the user can retry", async () => {
    const { flow, sessions, calls, alert } = await withSession({ confirm: { result: "error", reason: "internal_error" } });
    await flow.handleCodeModal(codeModal(calls));
    expect(calls.edits[0]!.content).toBe(m.tryLater);
    expect(sessions.pending(USER)).toBeDefined();
    expect(alert).not.toHaveBeenCalled();
  });
});

describe("Enter Code button and panel buttons", () => {
  function button(userId = USER) {
    return { user: { id: userId }, showModal: vi.fn(async (_modal: ModalBuilder) => {}), reply: vi.fn(async () => {}) };
  }

  it("opens the code modal only with a live session", async () => {
    const { flow, sessions } = setup();
    const none = button();
    await flow.handleEnterCodeButton(none);
    expect(none.showModal).not.toHaveBeenCalled();
    expect(none.reply).toHaveBeenCalledWith({ content: m.startOver, flags: MessageFlags.Ephemeral });

    sessions.begin(USER, { kind: "email", value: EMAIL });
    const live = button();
    await flow.handleEnterCodeButton(live);
    expect(live.showModal).toHaveBeenCalledTimes(1);
  });

  it("panel buttons open the matching identifier modal", async () => {
    const { flow } = setup();
    const b = button();
    await flow.handlePanelButton(b, "email");
    await flow.handlePanelButton(b, "locationId");
    const ids = b.showModal.mock.calls.map((c) => c[0].toJSON().custom_id);
    expect(ids).toEqual([IDS.modalEmail, IDS.modalLocation]);
  });

  it("a showModal failure never throws", async () => {
    const { flow } = setup();
    const b = button();
    b.showModal.mockRejectedValueOnce(new Error("boom"));
    await expect(flow.handlePanelButton(b, "email")).resolves.toBeUndefined();
  });
});

describe("I agree (verifiedUntil guard + role grant)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no verified flag → start over, role NOT granted", async () => {
    const { flow, grantRole, calls } = setup();
    await flow.handleAgreeButton(modal({}, calls));
    expect(calls.edits[0]!.content).toBe(m.startOver);
    expect(grantRole).not.toHaveBeenCalled();
  });

  it("an expired verified flag is treated as none", async () => {
    let t = 0;
    const sessions = createSessionStore({ now: () => t });
    const grantRole = vi.fn();
    const calls = newCalls();
    const flow = createVerifyFlow({
      serverClient: { verifyStart: vi.fn(), verifyConfirm: vi.fn() },
      sessions,
      rules: ["r"],
      supportPhone: PHONE,
      grantRole,
      alert: vi.fn(),
      logger: quietLog,
    });
    sessions.markVerified(USER);
    t = 10 * 60 * 1000 + 1;
    await flow.handleAgreeButton(modal({}, calls));
    expect(calls.edits[0]!.content).toBe(m.startOver);
    expect(grantRole).not.toHaveBeenCalled();
  });

  it("verified → grants the role, confirms privately, and consumes the flag (no replay)", async () => {
    const { flow, sessions, grantRole, calls } = setup();
    sessions.markVerified(USER);
    await flow.handleAgreeButton(modal({}, calls));
    expect(grantRole).toHaveBeenCalledWith(USER);
    expect(calls.edits[0]!.content).toBe(m.granted);
    expect(sessions.isVerified(USER)).toBe(false);

    const again = newCalls();
    await flow.handleAgreeButton(modal({}, again));
    expect(again.edits[0]!.content).toBe(m.startOver);
    expect(grantRole).toHaveBeenCalledTimes(1);
  });

  it("already holding the role is a successful no-op", async () => {
    const { flow, sessions, calls } = setup({ grant: { status: "already_had" } });
    sessions.markVerified(USER);
    await flow.handleAgreeButton(modal({}, calls));
    expect(calls.edits[0]!.content).toBe(m.granted);
  });

  it.each(["missing_permissions", "member_not_found", "role_not_found", "discord_unavailable"] as const)(
    "grant failure %s → generic try-again + reason-code alert, flag kept for retry",
    async (reason) => {
      const { flow, sessions, alert, calls } = setup({ grant: { status: "failed", reason } });
      sessions.markVerified(USER);
      await flow.handleAgreeButton(modal({}, calls));
      expect(calls.edits[0]!.content).toBe(m.tryLater);
      expect(alert).toHaveBeenCalledWith(`role_${reason}`);
      expect(sessions.isVerified(USER)).toBe(true);
    },
  );
});

describe("handlers never throw", () => {
  it("a throwing server client → try-later edit", async () => {
    const { flow, serverClient, calls } = setup();
    serverClient.verifyStart.mockRejectedValueOnce(new Error("boom"));
    await expect(flow.handleIdentifierModal(emailModal(calls), "email")).resolves.toBeUndefined();
    expect(calls.edits[0]!.content).toBe(m.tryLater);
  });

  it("a throwing grantRole → try-later edit", async () => {
    const { flow, sessions, calls } = setup({ grant: new Error("boom") });
    sessions.markVerified(USER);
    await expect(flow.handleAgreeButton(modal({}, calls))).resolves.toBeUndefined();
    expect(calls.edits[0]!.content).toBe(m.tryLater);
  });

  it("a failing deferReply or editReply is swallowed", async () => {
    const { flow, serverClient } = setup();
    const a = emailModal(newCalls());
    a.deferReply.mockRejectedValueOnce(new Error("expired"));
    await expect(flow.handleIdentifierModal(a, "email")).resolves.toBeUndefined();
    expect(serverClient.verifyStart).not.toHaveBeenCalled();

    const b = emailModal(newCalls());
    b.editReply.mockRejectedValueOnce(new Error("expired"));
    await expect(flow.handleIdentifierModal(b, "email")).resolves.toBeUndefined();
  });
});

describe("custom IDs carry no user data", () => {
  it("all component IDs are the static ones", () => {
    const panel = buildPanelMessage();
    const ids = panel.components[0]!.toJSON().components.map((c) => ("custom_id" in c ? c.custom_id : ""));
    expect(ids).toEqual([IDS.buttonEmail, IDS.buttonLocation]);
    for (const id of Object.values(IDS)) expect(id).toMatch(/^[a-z:-]+$/);
  });
});
