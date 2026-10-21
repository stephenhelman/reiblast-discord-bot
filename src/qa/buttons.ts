import { MessageFlags } from "discord.js";
import { createLogger, type Logger } from "../logger.js";
import { hasRole, type SetupInteractionLike } from "../verify/setup.js";
import { isAnswerButton, QA_IDS } from "./ids.js";
import { QA_TEXT } from "./messages.js";
import type { OutgoingMessage } from "./post.js";
import { hasTerminalTag, swapTags } from "./tags.js";
import type { TriggerConfig } from "./triggers.js";

/** The forum post a button was clicked in. */
export interface ThreadLike {
  id: string;
  /** The post's title (used when a summary has to be rebuilt from the thread). */
  name?: string;
  /** Link to the post. */
  url: string;
  ownerId: string | null;
  appliedTags: readonly string[];
  setAppliedTags(tags: string[], reason?: string): Promise<unknown>;
  send(message: OutgoingMessage): Promise<unknown>;
}

export interface AnswerButtonInteractionLike {
  customId: string;
  user: { id: string };
  member: SetupInteractionLike["member"];
  channel: ThreadLike | null;
  deferUpdate(): Promise<unknown>;
  /** Edits the message the button is on. */
  editReply(options: { components: [] }): Promise<unknown>;
  followUp(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
}

export interface EscalationRequest {
  /** "Still need help" on a general question (not_covered path). */
  kind: "still_need_help";
  thread: ThreadLike;
  /** The member (or staff) who clicked. */
  userId: string;
}

/**
 * Handlers for the buttons under a forum answer. Only the original poster or staff may use them. "That solved it" swaps
 * the post's tag to Resolved; "Still need help" removes the buttons and hands off to `escalate` (task 5). The buttons
 * are removed before any slow work, so a second click can't escalate twice.
 */
export function createAnswerButtonHandler(opts: {
  tags: TriggerConfig;
  staffRoleId: string;
  escalate: (req: EscalationRequest) => Promise<void>;
  alert: (code: string) => void;
  logger?: Logger;
}) {
  const log = opts.logger ?? createLogger("qa-buttons");
  const EPH = MessageFlags.Ephemeral;
  const inFlight = new Set<string>();

  /** Returns false if the interaction isn't one of ours. */
  return async function handle(i: AnswerButtonInteractionLike): Promise<boolean> {
    if (!isAnswerButton(i.customId)) return false;

    const thread = i.channel;
    if (!thread || thread.ownerId === null) {
      await i.reply({ content: QA_TEXT.genericError, flags: EPH });
      return true;
    }
    if (i.user.id !== thread.ownerId && !hasRole(i.member, opts.staffRoleId)) {
      log.warn("answer button denied", { reason: "not_op_or_staff" });
      await i.reply({ content: QA_TEXT.notAllowed, flags: EPH });
      return true;
    }
    if (inFlight.has(thread.id)) {
      await i.reply({ content: QA_TEXT.alreadyHandled, flags: EPH });
      return true;
    }

    inFlight.add(thread.id);
    try {
      await i.deferUpdate();

      if (hasTerminalTag(thread.appliedTags, opts.tags)) {
        // Already resolved or with staff: just clear the stale buttons.
        await i.editReply({ components: [] });
        log.info("answer button on handled post", { button: i.customId === QA_IDS.solved ? "solved" : "help" });
        return true;
      }

      if (i.customId === QA_IDS.solved) {
        try {
          await thread.setAppliedTags(swapTags(thread.appliedTags, opts.tags, "resolved"), "Member marked solved");
        } catch (err) {
          // Leave the buttons so it can be retried; staff fix the tag by hand.
          log.error("tag swap failed", { error: err instanceof Error ? err.name : "unknown" });
          opts.alert("qa_tag_swap_failed");
          await i.followUp({ content: QA_TEXT.genericError, flags: EPH });
          return true;
        }
        await i.editReply({ components: [] });
        await i.followUp({ content: QA_TEXT.solvedAck, flags: EPH });
        log.info("answer resolved");
        return true;
      }

      // Still need help
      await i.editReply({ components: [] });
      try {
        await opts.escalate({ kind: "still_need_help", thread, userId: i.user.id });
        log.info("answer escalated", { via: "button" });
      } catch (err) {
        log.error("escalation failed", { error: err instanceof Error ? err.name : "unknown" });
        opts.alert("qa_escalation_failed");
        await i.followUp({ content: QA_TEXT.genericError, flags: EPH });
      }
      return true;
    } catch (err) {
      log.error("answer button failed", { error: err instanceof Error ? err.name : "unknown" });
      opts.alert("qa_button_failed");
      return true;
    } finally {
      inFlight.delete(thread.id);
    }
  };
}

export type AnswerButtonHandler = ReturnType<typeof createAnswerButtonHandler>;
