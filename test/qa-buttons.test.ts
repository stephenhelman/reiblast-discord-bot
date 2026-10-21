import { MessageFlags } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createAnswerButtonHandler, type AnswerButtonInteractionLike, type EscalationRequest, type ThreadLike } from "../src/qa/buttons.js";
import { QA_TEXT } from "../src/qa/messages.js";
import type { Logger } from "../src/logger.js";

const cfg = { tagSupportId: "T_SUP", tagResolvedId: "T_RES", tagNeedsStaffId: "T_STAFF" };
const STAFF_ROLE = "222222222222222222";
const OP = "u-op";
const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function thread(over: Partial<{ ownerId: string | null; appliedTags: string[]; setAppliedTags: ThreadLike["setAppliedTags"] }> = {}) {
  return {
    id: "thread-1",
    ownerId: OP as string | null,
    appliedTags: [cfg.tagSupportId, "other"],
    setAppliedTags: vi.fn(async (_t: string[], _r?: string) => {}),
    ...over,
  };
}

function click(customId: string, over: Partial<AnswerButtonInteractionLike> = {}) {
  const calls: string[] = [];
  const i = {
    customId,
    user: { id: OP },
    member: { roles: [] as string[] },
    channel: thread(),
    deferUpdate: vi.fn(async () => void calls.push("deferUpdate")),
    editReply: vi.fn(async (_o: { components: [] }) => void calls.push("editReply")),
    followUp: vi.fn(async (_o: { content: string; flags: MessageFlags.Ephemeral }) => void calls.push("followUp")),
    reply: vi.fn(async (_o: { content: string; flags: MessageFlags.Ephemeral }) => void calls.push("reply")),
    ...over,
  } satisfies AnswerButtonInteractionLike;
  return { i, calls };
}

function setup(escalate: (r: EscalationRequest) => Promise<void> = async () => {}) {
  const alert = vi.fn();
  const esc = vi.fn(escalate);
  const handle = createAnswerButtonHandler({ tags: cfg, staffRoleId: STAFF_ROLE, escalate: esc, alert, logger: quiet });
  return { handle, alert, esc };
}

const EPH = MessageFlags.Ephemeral;

describe("routing", () => {
  it("ignores interactions that aren't ours", async () => {
    const { handle } = setup();
    const { i } = click("verify:agree");
    expect(await handle(i)).toBe(false);
    expect(i.deferUpdate).not.toHaveBeenCalled();
    expect(i.reply).not.toHaveBeenCalled();
  });
});

describe("authorization", () => {
  it("rejects someone who isn't the poster or staff, ephemerally, touching nothing", async () => {
    const { handle, esc } = setup();
    const { i } = click("qa:solved", { user: { id: "stranger" } });
    expect(await handle(i)).toBe(true);
    expect(i.reply).toHaveBeenCalledWith({ content: QA_TEXT.notAllowed, flags: EPH });
    expect(i.channel!.setAppliedTags).not.toHaveBeenCalled();
    expect(i.deferUpdate).not.toHaveBeenCalled();
    expect(esc).not.toHaveBeenCalled();
  });

  it("lets staff use the buttons in someone else's post (role-id array or role cache)", async () => {
    for (const member of [{ roles: [STAFF_ROLE] }, { roles: { cache: { has: (id: string) => id === STAFF_ROLE } } }]) {
      const { handle } = setup();
      const { i } = click("qa:solved", { user: { id: "staff-user" }, member });
      await handle(i);
      expect(i.channel!.setAppliedTags).toHaveBeenCalled();
    }
  });

  it("rejects when the poster is unknown (deleted account) and the clicker isn't staff", async () => {
    const { handle } = setup();
    const { i } = click("qa:solved", { channel: thread({ ownerId: null }) });
    await handle(i);
    expect(i.reply).toHaveBeenCalledWith({ content: QA_TEXT.genericError, flags: EPH });
    expect(i.channel!.setAppliedTags).not.toHaveBeenCalled();
  });

  it("rejects a click outside a thread", async () => {
    const { handle } = setup();
    const { i } = click("qa:help", { channel: null });
    await handle(i);
    expect(i.reply).toHaveBeenCalledWith({ content: QA_TEXT.genericError, flags: EPH });
  });
});

describe("That solved it", () => {
  it("swaps Support for Resolved (keeping other tags), removes the buttons, and thanks them privately", async () => {
    const { handle, alert, esc } = setup();
    const { i, calls } = click("qa:solved");
    await handle(i);
    expect(i.channel!.setAppliedTags).toHaveBeenCalledWith(["other", cfg.tagResolvedId], expect.any(String));
    expect(i.editReply).toHaveBeenCalledWith({ components: [] });
    expect(i.followUp).toHaveBeenCalledWith({ content: QA_TEXT.solvedAck, flags: EPH });
    expect(calls).toEqual(["deferUpdate", "editReply", "followUp"]);
    expect(esc).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it("keeps the buttons, tells the member, and alerts staff if the tag swap fails", async () => {
    const { handle, alert } = setup();
    const ch = thread({ setAppliedTags: vi.fn(async () => Promise.reject(new Error("Missing Permissions"))) });
    const { i } = click("qa:solved", { channel: ch });
    await handle(i);
    expect(alert).toHaveBeenCalledWith("qa_tag_swap_failed");
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledWith({ content: QA_TEXT.genericError, flags: EPH });
  });
});

describe("Still need help", () => {
  it("removes the buttons first, then escalates with the thread and clicker", async () => {
    const order: string[] = [];
    const { handle, esc } = setup(async () => void order.push("escalate"));
    const { i } = click("qa:help", { editReply: vi.fn(async () => void order.push("editReply")) });
    await handle(i);
    expect(order).toEqual(["editReply", "escalate"]);
    expect(esc).toHaveBeenCalledWith({ kind: "still_need_help", thread: i.channel, userId: OP });
    expect(i.channel!.setAppliedTags).not.toHaveBeenCalled(); // tagging is the escalation's job
  });

  it("alerts staff and tells the member if escalation throws", async () => {
    const { handle, alert } = setup(async () => Promise.reject(new Error("boom")));
    const { i } = click("qa:help");
    await handle(i);
    expect(alert).toHaveBeenCalledWith("qa_escalation_failed");
    expect(i.followUp).toHaveBeenCalledWith({ content: QA_TEXT.genericError, flags: EPH });
  });

  it("a second click while the first is in flight does not escalate twice", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { handle, esc } = setup(() => gate);
    const first = click("qa:help");
    const second = click("qa:help");
    const p1 = handle(first.i);
    await new Promise((r) => setTimeout(r, 0));
    await handle(second.i);
    expect(second.i.reply).toHaveBeenCalledWith({ content: QA_TEXT.alreadyHandled, flags: EPH });
    release();
    await p1;
    expect(esc).toHaveBeenCalledTimes(1);
  });
});

describe("posts that are already handled", () => {
  it.each([["Resolved", "T_RES"], ["Needs Staff", "T_STAFF"]])("just clears stale buttons on a %s post", async (_n, tag) => {
    for (const id of ["qa:solved", "qa:help"]) {
      const { handle, esc, alert } = setup();
      const { i } = click(id, { channel: thread({ appliedTags: [cfg.tagSupportId, tag] }) });
      await handle(i);
      expect(i.editReply).toHaveBeenCalledWith({ components: [] });
      expect(i.channel!.setAppliedTags).not.toHaveBeenCalled();
      expect(esc).not.toHaveBeenCalled();
      expect(alert).not.toHaveBeenCalled();
    }
  });
});

describe("unexpected failures", () => {
  it("alerts and never throws", async () => {
    const { handle, alert } = setup();
    const { i } = click("qa:solved", { deferUpdate: vi.fn(async () => Promise.reject(new Error("Unknown interaction"))) });
    await expect(handle(i)).resolves.toBe(true);
    expect(alert).toHaveBeenCalledWith("qa_button_failed");
  });

  it("can handle another click on the same post after a failure", async () => {
    const { handle, esc } = setup();
    const bad = click("qa:help", { deferUpdate: vi.fn(async () => Promise.reject(new Error("x"))) });
    await handle(bad.i);
    await handle(click("qa:help").i);
    expect(esc).toHaveBeenCalledTimes(1);
  });
});
