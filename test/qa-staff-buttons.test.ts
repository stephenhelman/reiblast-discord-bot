import { MessageFlags } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { AlreadyPrivateError } from "../src/qa/escalate.js";
import { QA_TEXT } from "../src/qa/messages.js";
import type { OutgoingMessage } from "../src/qa/post.js";
import { createStaffButtonHandler, type StaffButtonChannel, type StaffButtonInteractionLike } from "../src/qa/staff-buttons.js";
import type { Logger } from "../src/logger.js";

const STAFF_ROLE = "222222222222222222";
const SUPPORT_ROLE = "333333333333333333";
const BOT = "100000000000000001";
const OP = "100000000000000002";
const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const EPH = MessageFlags.Ephemeral;
const member = { id: OP, displayName: "Jane" };

function channel(over: Partial<StaffButtonChannel> = {}) {
  const calls: string[] = [];
  const sent: OutgoingMessage[] = [];
  const ch = {
    id: "post-1",
    url: "https://discord.com/channels/1/post-1",
    ownerId: OP as string | null,
    appliedTags: ["T_STAFF"],
    setAppliedTags: vi.fn(async () => {}),
    send: vi.fn(async (m: OutgoingMessage) => void (calls.push("send"), sent.push(m))),
    edit: vi.fn(async (_o: { archived?: boolean; locked?: boolean; reason?: string }) => void calls.push("edit")),
    ...over,
  } satisfies StaffButtonChannel;
  return { ch, calls, sent };
}

function click(customId: string, ch: StaffButtonChannel | null, calls: string[] = [], over: Partial<StaffButtonInteractionLike> = {}) {
  return {
    customId,
    user: { id: "staff-user" },
    member: { roles: [STAFF_ROLE] } as StaffButtonInteractionLike["member"],
    channel: ch,
    deferUpdate: vi.fn(async () => void calls.push("defer")),
    editReply: vi.fn(async (_o: { components: [] }) => void calls.push("editReply")),
    followUp: vi.fn(async (_o: { content: string; flags: MessageFlags.Ephemeral }) => void calls.push("followUp")),
    reply: vi.fn(async (_o: { content: string; flags: MessageFlags.Ephemeral }) => void calls.push("reply")),
    ...over,
  } satisfies StaffButtonInteractionLike;
}

function setup(over: { moveToPrivate?: () => Promise<void>; resolveMember?: () => Promise<typeof member | null> } = {}) {
  const alert = vi.fn();
  const moveToPrivate = vi.fn(over.moveToPrivate ?? (async () => {}));
  const staffLog = { needsStaff: vi.fn(), privateThread: vi.fn(), movedToPrivate: vi.fn(), closed: vi.fn() };
  const handle = createStaffButtonHandler({
    staffRoleId: STAFF_ROLE,
    supportRoleId: SUPPORT_ROLE,
    botId: BOT,
    needsStaffTagId: "T_STAFF",
    escalator: { moveToPrivate },
    resolveMember: vi.fn(over.resolveMember ?? (async () => member)),
    staffLog,
    alert,
    logger: quiet,
  });
  return { handle, alert, moveToPrivate, staffLog };
}

describe("routing and staff gating", () => {
  it("ignores interactions that aren't ours", async () => {
    const { handle } = setup();
    const i = click("qa:solved", channel().ch);
    expect(await handle(i)).toBe(false);
    expect(i.deferUpdate).not.toHaveBeenCalled();
  });

  it("refuses non-staff, ephemerally, doing nothing", async () => {
    const { handle, moveToPrivate } = setup();
    const { ch } = channel();
    const i = click("qa:to-private", ch, [], { member: { roles: [] } });
    expect(await handle(i)).toBe(true);
    expect(i.reply).toHaveBeenCalledWith({ content: QA_TEXT.staffOnly, flags: EPH });
    expect(moveToPrivate).not.toHaveBeenCalled();
    expect(i.deferUpdate).not.toHaveBeenCalled();
  });

  it.each([["staff role", STAFF_ROLE], ["support role", SUPPORT_ROLE]])("accepts the %s", async (_n, role) => {
    const { handle, moveToPrivate } = setup();
    const { ch } = channel();
    await handle(click("qa:to-private", ch, [], { member: { roles: [role] } }));
    expect(moveToPrivate).toHaveBeenCalled();
  });

  it("rejects a click outside a thread", async () => {
    const { handle } = setup();
    const i = click("qa:close", null);
    await handle(i);
    expect(i.reply).toHaveBeenCalledWith({ content: QA_TEXT.genericError, flags: EPH });
  });
});

describe("Move to private", () => {
  it("opens the thread for the post's poster, then removes the button", async () => {
    const { handle, moveToPrivate } = setup();
    const { ch, calls } = channel();
    await handle(click("qa:to-private", ch, calls));
    expect(moveToPrivate).toHaveBeenCalledWith(ch, member);
    expect(calls).toEqual(["defer", "editReply"]);
  });

  it("just clears a stale button on a post that isn't Needs Staff", async () => {
    const { handle, moveToPrivate } = setup();
    const { ch } = channel({ appliedTags: ["T_RES"] });
    const i = click("qa:to-private", ch);
    await handle(i);
    expect(moveToPrivate).not.toHaveBeenCalled();
    expect(i.editReply).toHaveBeenCalledWith({ components: [] });
  });

  it("tells staff when the member has left, and keeps the button", async () => {
    const { handle, moveToPrivate } = setup({ resolveMember: async () => null });
    const i = click("qa:to-private", channel().ch);
    await handle(i);
    expect(i.followUp).toHaveBeenCalledWith({ content: QA_TEXT.memberGone, flags: EPH });
    expect(i.editReply).not.toHaveBeenCalled();
    expect(moveToPrivate).not.toHaveBeenCalled();
  });

  it("clears the button and says so if a private thread already exists", async () => {
    const { handle } = setup({ moveToPrivate: async () => Promise.reject(new AlreadyPrivateError()) });
    const i = click("qa:to-private", channel().ch);
    await handle(i);
    expect(i.editReply).toHaveBeenCalledWith({ components: [] });
    expect(i.followUp).toHaveBeenCalledWith({ content: QA_TEXT.alreadyPrivate, flags: EPH });
  });

  it("keeps the button, alerts, and tells staff when it fails (so they can retry)", async () => {
    const { handle, alert } = setup({ moveToPrivate: async () => Promise.reject(new Error("boom")) });
    const i = click("qa:to-private", channel().ch);
    await handle(i);
    expect(alert).toHaveBeenCalledWith("qa_escalation_failed");
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledWith({ content: QA_TEXT.genericError, flags: EPH });
  });

  it("a second click while the first is in flight does nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { handle, moveToPrivate } = setup({ moveToPrivate: () => gate });
    const { ch } = channel();
    const p1 = handle(click("qa:to-private", ch));
    await new Promise((r) => setTimeout(r, 0));
    const second = click("qa:to-private", ch);
    await handle(second);
    expect(second.reply).toHaveBeenCalledWith({ content: QA_TEXT.alreadyHandled, flags: EPH });
    release();
    await p1;
    expect(moveToPrivate).toHaveBeenCalledTimes(1);
  });
});

describe("Close (private thread)", () => {
  const privateThread = () => channel({ ownerId: BOT, appliedTags: [] });

  it("removes the button, posts the fixed closing message, archives AND locks, then logs", async () => {
    const { handle, staffLog } = setup();
    const { ch, calls, sent } = privateThread();
    await handle(click("qa:close", ch, calls));

    expect(calls).toEqual(["defer", "editReply", "send", "edit"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.content).toBe(QA_TEXT.closed);
    expect(sent[0]!.content).toMatch(/new post in the support forum/);
    expect(sent[0]!.allowedMentions).toEqual({ parse: [] });
    expect(ch.edit).toHaveBeenCalledWith({ archived: true, locked: true, reason: expect.any(String) });
    expect(staffLog.closed).toHaveBeenCalledWith(ch.url);
  });

  it("refuses to close a thread the bot didn't open", async () => {
    const { handle } = setup();
    const { ch } = channel({ ownerId: OP });
    const i = click("qa:close", ch);
    await handle(i);
    expect(ch.edit).not.toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledWith({ content: QA_TEXT.genericError, flags: EPH });
  });

  it("doesn't archive if the closing message can't be posted, and alerts", async () => {
    const { handle, alert, staffLog } = setup();
    const { ch } = privateThread();
    (ch.send as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Missing Permissions"));
    const i = click("qa:close", ch);
    await handle(i);
    expect(ch.edit).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith("qa_escalation_failed");
    expect(i.followUp).toHaveBeenCalledWith({ content: QA_TEXT.genericError, flags: EPH });
    expect(staffLog.closed).not.toHaveBeenCalled();
  });

  it("alerts and doesn't log 'closed' if archiving fails", async () => {
    const { handle, alert, staffLog } = setup();
    const { ch } = privateThread();
    (ch.edit as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Missing Permissions"));
    await handle(click("qa:close", ch));
    expect(alert).toHaveBeenCalledWith("qa_escalation_failed");
    expect(staffLog.closed).not.toHaveBeenCalled();
  });
});

describe("unexpected failures", () => {
  it("alerts and never throws", async () => {
    const { handle, alert } = setup();
    const i = click("qa:close", channel({ ownerId: BOT }).ch, [], { deferUpdate: vi.fn(async () => Promise.reject(new Error("Unknown interaction"))) });
    await expect(handle(i)).resolves.toBe(true);
    expect(alert).toHaveBeenCalledWith("qa_escalation_failed");
  });
});
