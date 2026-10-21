import { MessageFlags } from "discord.js";
import { createLogger, type Logger } from "../logger.js";
import { hasRole, type SetupInteractionLike } from "../verify/setup.js";
import type { ThreadLike } from "./buttons.js";
import { AlreadyPrivateError, type Escalator, type Member } from "./escalate.js";
import { isStaffButton, QA_IDS } from "./ids.js";
import { QA_TEXT } from "./messages.js";
import { postFixedText, threadTarget } from "./post.js";
import type { StaffLog } from "./stafflog.js";

export interface StaffButtonChannel extends ThreadLike {
  edit(options: { archived?: boolean; locked?: boolean; reason?: string }): Promise<unknown>;
}

export interface StaffButtonInteractionLike {
  customId: string;
  user: { id: string };
  member: SetupInteractionLike["member"];
  channel: StaffButtonChannel | null;
  deferUpdate(): Promise<unknown>;
  editReply(options: { components: [] }): Promise<unknown>;
  followUp(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
}

/**
 * Staff-only buttons. "Move to private" (on the handoff message in a Needs Staff post) opens a private thread for the
 * post's poster. "Close" (on the first message of a private thread) posts the fixed closing message, then archives AND
 * locks the thread. Staff = the staff role or the support role.
 */
export function createStaffButtonHandler(opts: {
  staffRoleId: string;
  supportRoleId: string;
  botId: string;
  needsStaffTagId: string;
  escalator: Pick<Escalator, "moveToPrivate">;
  resolveMember: (userId: string) => Promise<Member | null>;
  staffLog: StaffLog;
  alert: (code: string) => void;
  logger?: Logger;
}) {
  const log = opts.logger ?? createLogger("qa-staff-buttons");
  const EPH = MessageFlags.Ephemeral;
  const inFlight = new Set<string>();

  /** Returns false if the interaction isn't one of ours. */
  return async function handle(i: StaffButtonInteractionLike): Promise<boolean> {
    if (!isStaffButton(i.customId)) return false;

    if (!hasRole(i.member, opts.staffRoleId) && !hasRole(i.member, opts.supportRoleId)) {
      log.warn("staff button denied", { reason: "not_staff" });
      await i.reply({ content: QA_TEXT.staffOnly, flags: EPH });
      return true;
    }
    const channel = i.channel;
    if (!channel) {
      await i.reply({ content: QA_TEXT.genericError, flags: EPH });
      return true;
    }
    if (inFlight.has(channel.id)) {
      await i.reply({ content: QA_TEXT.alreadyHandled, flags: EPH });
      return true;
    }

    inFlight.add(channel.id);
    try {
      await i.deferUpdate();
      if (i.customId === QA_IDS.toPrivate) await moveToPrivate(i, channel);
      else await close(i, channel);
    } catch (err) {
      log.error("staff button failed", { error: err instanceof Error ? err.name : "unknown" });
      opts.alert("qa_escalation_failed");
    } finally {
      inFlight.delete(channel.id);
    }
    return true;
  };

  async function moveToPrivate(i: StaffButtonInteractionLike, post: StaffButtonChannel): Promise<void> {
    if (!post.appliedTags.includes(opts.needsStaffTagId) || post.ownerId === null) {
      await i.editReply({ components: [] }); // stale button
      return;
    }
    const member = await opts.resolveMember(post.ownerId);
    if (!member) {
      await i.followUp({ content: QA_TEXT.memberGone, flags: EPH });
      return;
    }
    try {
      await opts.escalator.moveToPrivate(post, member);
    } catch (err) {
      if (err instanceof AlreadyPrivateError) {
        await i.editReply({ components: [] });
        await i.followUp({ content: QA_TEXT.alreadyPrivate, flags: EPH });
        return;
      }
      // The button stays so staff can retry.
      log.error("move to private failed", { error: err instanceof Error ? err.name : "unknown" });
      opts.alert("qa_escalation_failed");
      await i.followUp({ content: QA_TEXT.genericError, flags: EPH });
      return;
    }
    await i.editReply({ components: [] });
  }

  async function close(i: StaffButtonInteractionLike, thread: StaffButtonChannel): Promise<void> {
    if (thread.ownerId !== opts.botId) {
      await i.followUp({ content: QA_TEXT.genericError, flags: EPH });
      return;
    }
    try {
      // Order matters: a message can't be edited or posted once the thread is archived and locked.
      await i.editReply({ components: [] });
      await postFixedText(threadTarget(thread), QA_TEXT.closed, { first: "send" });
      await thread.edit({ archived: true, locked: true, reason: "Closed by staff" });
    } catch (err) {
      log.error("close failed", { error: err instanceof Error ? err.name : "unknown" });
      opts.alert("qa_escalation_failed");
      await i.followUp({ content: QA_TEXT.genericError, flags: EPH });
      return;
    }
    opts.staffLog.closed(thread.url);
    log.info("private thread closed");
  }
}

export type StaffButtonHandler = ReturnType<typeof createStaffButtonHandler>;
