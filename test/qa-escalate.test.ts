import { describe, expect, it, vi } from "vitest";
import type { ThreadLike } from "../src/qa/buttons.js";
import { AlreadyPrivateError, createEscalator } from "../src/qa/escalate.js";
import { QA_TEXT } from "../src/qa/messages.js";
import type { OutgoingMessage } from "../src/qa/post.js";
import { PrivateThreadError, type PrivateThreadCreator } from "../src/qa/private-thread.js";
import type { StaffLog } from "../src/qa/stafflog.js";
import type { Logger } from "../src/logger.js";

const tags = { tagSupportId: "T_SUP", tagResolvedId: "T_RES", tagNeedsStaffId: "T_STAFF" };
const ROLE = "555555555555555555";
const POST_ID = "900000000000000010";
const POST_URL = "https://discord.com/channels/1/900000000000000010";
const PRIV_ID = "800000000000000001";
const PRIV_URL = "https://discord.com/channels/1/800000000000000001";
const QUESTION = "SECRET-QUESTION-TEXT why was I charged?";
const asker = { id: "100000000000000002", displayName: "Jane" };
const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function setup(over: { setTags?: () => Promise<unknown>; send?: () => Promise<unknown>; create?: PrivateThreadCreator } = {}) {
  const order: string[] = [];
  const sent: OutgoingMessage[] = [];
  const thread = {
    id: POST_ID,
    url: POST_URL,
    ownerId: "u-op" as string | null,
    appliedTags: ["T_SUP", "other"],
    setAppliedTags: vi.fn(async (_t: string[], _r?: string) => {
      order.push("tags");
      if (over.setTags) await over.setTags();
    }),
    send: vi.fn(async (m: OutgoingMessage) => {
      order.push("post");
      sent.push(m);
      if (over.send) await over.send();
    }),
  } satisfies ThreadLike;
  const createPrivateThread = vi.fn(
    over.create ?? (async () => (order.push("private"), { id: PRIV_ID, url: PRIV_URL })),
  ) as unknown as PrivateThreadCreator & ReturnType<typeof vi.fn>;
  const staffLog = {
    needsStaff: vi.fn(() => void order.push("log")),
    privateThread: vi.fn(() => void order.push("log")),
    movedToPrivate: vi.fn(() => void order.push("log")),
    closed: vi.fn(),
  } satisfies StaffLog;
  const alert = vi.fn();
  const esc = createEscalator({ tags, supportRoleId: ROLE, createPrivateThread, staffLog, alert, logger: quiet });
  return { esc, thread, sent, order, createPrivateThread, staffLog, alert };
}

describe("handoff (not_covered, Still need help, turn cap, model failures)", () => {
  it("swaps the tag to Needs Staff first, posts the fixed handoff with the one role ping and a Move-to-private button, then logs", async () => {
    const t = setup();
    await t.esc.handoff(t.thread, "not_covered");

    expect(t.order).toEqual(["tags", "post", "log"]);
    expect(t.thread.setAppliedTags).toHaveBeenCalledWith(["other", "T_STAFF"], expect.any(String));
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.content).toBe(QA_TEXT.handoff(ROLE));
    expect(t.sent[0]!.allowedMentions).toEqual({ parse: [], roles: [ROLE] });
    expect(t.sent[0]!.components?.[0]?.toJSON().components).toMatchObject([{ custom_id: "qa:to-private", label: "Move to private" }]);
    expect(t.staffLog.needsStaff).toHaveBeenCalledWith("not_covered", POST_URL);
    expect(t.alert).not.toHaveBeenCalled();
  });

  it("treats a model failure exactly like not_covered, plus a reason-only alert", async () => {
    const t = setup();
    await t.esc.handoff(t.thread, "qa_timeout");
    expect(t.sent[0]!.content).toBe(QA_TEXT.handoff(ROLE));
    expect(t.staffLog.needsStaff).toHaveBeenCalledWith("qa_timeout", POST_URL);
    expect(t.alert).toHaveBeenCalledWith("qa_timeout");
  });

  it.each(["help_button", "turn_cap", "qa_api_error", "qa_refusal", "qa_max_tokens", "qa_bad_output"] as const)("%s does the same", async (reason) => {
    const t = setup();
    await t.esc.handoff(t.thread, reason);
    expect(t.staffLog.needsStaff).toHaveBeenCalledWith(reason, POST_URL);
    expect(t.alert).toHaveBeenCalledTimes(reason.startsWith("qa_") ? 1 : 0);
  });

  it("never posts model text: the only message is the fixed template", async () => {
    const t = setup();
    await t.esc.handoff(t.thread, "qa_bad_output");
    expect(t.sent.map((m) => m.content)).toEqual([QA_TEXT.handoff(ROLE)]);
  });

  it("still posts and logs if the tag swap fails, and alerts staff", async () => {
    const t = setup({ setTags: async () => Promise.reject(new Error("Missing Permissions")) });
    await expect(t.esc.handoff(t.thread, "not_covered")).resolves.toBeUndefined();
    expect(t.alert).toHaveBeenCalledWith("qa_tag_swap_failed");
    expect(t.sent).toHaveLength(1);
    expect(t.staffLog.needsStaff).toHaveBeenCalled();
  });

  it("still logs if the post fails, alerts staff, and never throws", async () => {
    const t = setup({ send: async () => Promise.reject(new Error("Missing Access")) });
    await expect(t.esc.handoff(t.thread, "not_covered")).resolves.toBeUndefined();
    expect(t.alert).toHaveBeenCalledWith("qa_post_failed");
    expect(t.staffLog.needsStaff).toHaveBeenCalledWith("not_covered", POST_URL);
  });
});

describe("accountSpecific", () => {
  it("swaps the tag, opens a private thread for the asker with their question, posts a detail-free public note, logs both links", async () => {
    const t = setup();
    await t.esc.accountSpecific(t.thread, asker, QUESTION);

    expect(t.order).toEqual(["tags", "private", "post", "log"]);
    expect(t.createPrivateThread).toHaveBeenCalledWith({
      reason: "staff_handoff",
      member: asker,
      source: { postId: POST_ID, url: POST_URL },
      question: QUESTION,
    });
    // public note: fixed text, links the thread, no ping, no details, no buttons
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.content).toBe(QA_TEXT.privateNote(PRIV_ID));
    expect(t.sent[0]!.allowedMentions).toEqual({ parse: [] });
    expect(t.sent[0]!.components).toBeUndefined();
    expect(t.staffLog.privateThread).toHaveBeenCalledWith("account_specific", POST_URL, PRIV_URL);
    expect(t.alert).not.toHaveBeenCalled();
  });

  it("never leaks the question into the public note, the staff log, or an alert", async () => {
    const t = setup();
    await t.esc.accountSpecific(t.thread, asker, QUESTION);
    const dump = JSON.stringify([t.sent.map((m) => m.content), t.staffLog.privateThread.mock.calls, t.staffLog.needsStaff.mock.calls, t.alert.mock.calls]);
    expect(dump).not.toContain("SECRET-QUESTION-TEXT");
  });

  it("falls back to the normal handoff (ping + Move-to-private button), alerts staff and logs, if the private thread fails", async () => {
    const t = setup({ create: (async () => Promise.reject(new PrivateThreadError("create"))) as unknown as PrivateThreadCreator });
    await expect(t.esc.accountSpecific(t.thread, asker, QUESTION)).resolves.toBeUndefined();

    expect(t.alert).toHaveBeenCalledWith("qa_escalation_failed");
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.content).toBe(QA_TEXT.handoff(ROLE));
    expect(t.sent[0]!.allowedMentions).toEqual({ parse: [], roles: [ROLE] });
    expect(t.sent[0]!.components).toBeDefined();
    expect(t.staffLog.privateThread).not.toHaveBeenCalled();
    expect(t.staffLog.needsStaff).toHaveBeenCalledWith("account_specific_private_failed", POST_URL);
    expect(t.thread.setAppliedTags).toHaveBeenCalledTimes(1); // swapped once, not again in the fallback
  });

  it("still logs the private thread if only the public note fails", async () => {
    const t = setup({ send: async () => Promise.reject(new Error("boom")) });
    await t.esc.accountSpecific(t.thread, asker, QUESTION);
    expect(t.alert).toHaveBeenCalledWith("qa_post_failed");
    expect(t.staffLog.privateThread).toHaveBeenCalledWith("account_specific", POST_URL, PRIV_URL);
  });
});

describe("moveToPrivate (staff button)", () => {
  it("opens the thread for the poster without a question, posts the note, logs", async () => {
    const t = setup();
    await t.esc.moveToPrivate(t.thread, asker);
    expect(t.createPrivateThread).toHaveBeenCalledWith({
      reason: "staff_handoff",
      member: asker,
      source: { postId: POST_ID, url: POST_URL },
    });
    expect(t.sent[0]!.content).toBe(QA_TEXT.privateNote(PRIV_ID));
    expect(t.staffLog.movedToPrivate).toHaveBeenCalledWith(POST_URL, PRIV_URL);
    expect(t.thread.setAppliedTags).not.toHaveBeenCalled(); // already Needs Staff
  });

  it("won't open a second private thread for the same post", async () => {
    const t = setup();
    await t.esc.moveToPrivate(t.thread, asker);
    await expect(t.esc.moveToPrivate(t.thread, asker)).rejects.toBeInstanceOf(AlreadyPrivateError);
    expect(t.createPrivateThread).toHaveBeenCalledTimes(1);
  });

  it("also blocks a staff 'move to private' after account_specific already opened one", async () => {
    const t = setup();
    await t.esc.accountSpecific(t.thread, asker, QUESTION);
    await expect(t.esc.moveToPrivate(t.thread, asker)).rejects.toBeInstanceOf(AlreadyPrivateError);
  });

  it("propagates a failure and allows a retry", async () => {
    let calls = 0;
    const t = setup({
      create: (async () => {
        if (++calls === 1) throw new PrivateThreadError("create");
        return { id: PRIV_ID, url: PRIV_URL };
      }) as unknown as PrivateThreadCreator,
    });
    await expect(t.esc.moveToPrivate(t.thread, asker)).rejects.toBeInstanceOf(PrivateThreadError);
    await expect(t.esc.moveToPrivate(t.thread, asker)).resolves.toBeUndefined();
  });
});
