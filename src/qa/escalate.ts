import { createLogger, type Logger } from "../logger.js";
import type { QaFailure } from "./answer.js";
import type { ThreadLike } from "./buttons.js";
import { buildMovePrivateRow } from "./components.js";
import { QA_TEXT } from "./messages.js";
import { postFixedText, threadTarget } from "./post.js";
import type { PrivateThreadCreator } from "./private-thread.js";
import type { StaffLog } from "./stafflog.js";
import { swapTags } from "./tags.js";
import type { TriggerConfig } from "./triggers.js";

/** Why a post is being handed to staff. `qa_*` are model failures (also raised as a deduped, reason-only alert). */
export type EscalationReason = "not_covered" | "help_button" | "turn_cap" | `qa_${QaFailure}`;

export interface Member {
  id: string;
  displayName: string;
}

export class AlreadyPrivateError extends Error {}

/**
 * The escalation flows. Every step is fixed text. The post's tag is swapped to Needs Staff FIRST, so a post is never left
 * in limbo and a repeated click can't escalate twice; later steps degrade to the normal handoff rather than failing.
 */
export function createEscalator(opts: {
  tags: TriggerConfig;
  supportRoleId: string;
  createPrivateThread: PrivateThreadCreator;
  staffLog: StaffLog;
  alert: (code: string) => void;
  logger?: Logger;
}) {
  const log = opts.logger ?? createLogger("escalate");
  const privateBySource = new Map<string, string>(); // post id -> private thread url (bounded)

  const rememberPrivate = (postId: string, url: string) => {
    privateBySource.set(postId, url);
    if (privateBySource.size > 1000) privateBySource.delete(privateBySource.keys().next().value!);
  };

  async function swapToNeedsStaff(thread: ThreadLike): Promise<void> {
    try {
      await thread.setAppliedTags(swapTags(thread.appliedTags, opts.tags, "needs_staff"), "Escalated to staff");
    } catch (err) {
      log.error("tag swap failed", { error: err instanceof Error ? err.name : "unknown" });
      opts.alert("qa_tag_swap_failed");
    }
  }

  /** "Handing this to the team" + the one support-role ping + the staff-only Move-to-private button. */
  async function postHandoff(thread: ThreadLike): Promise<void> {
    try {
      await postFixedText(threadTarget(thread), QA_TEXT.handoff(opts.supportRoleId), {
        first: "send",
        pingRoleId: opts.supportRoleId,
        components: [buildMovePrivateRow()],
      });
    } catch (err) {
      log.error("handoff post failed", { error: err instanceof Error ? err.name : "unknown" });
      opts.alert("qa_post_failed");
    }
  }

  async function postPrivateNote(thread: ThreadLike, privateThreadId: string): Promise<void> {
    try {
      await postFixedText(threadTarget(thread), QA_TEXT.privateNote(privateThreadId), { first: "send" });
    } catch (err) {
      log.error("private note failed", { error: err instanceof Error ? err.name : "unknown" });
      opts.alert("qa_post_failed");
    }
  }

  return {
    /** not_covered, "Still need help", turn cap, or a model failure. Never throws. */
    async handoff(thread: ThreadLike, reason: EscalationReason): Promise<void> {
      await swapToNeedsStaff(thread);
      await postHandoff(thread);
      opts.staffLog.needsStaff(reason, thread.url);
      if (reason.startsWith("qa_")) opts.alert(reason);
      log.info("handed to staff", { reason });
    },

    /** account_specific: private thread with the member; falls back to the normal handoff if that fails. Never throws. */
    async accountSpecific(thread: ThreadLike, asker: Member, question: string): Promise<void> {
      await swapToNeedsStaff(thread);
      try {
        const priv = await opts.createPrivateThread({
          reason: "staff_handoff",
          member: asker,
          source: { postId: thread.id, url: thread.url },
          question,
        });
        rememberPrivate(thread.id, priv.url);
        await postPrivateNote(thread, priv.id);
        opts.staffLog.privateThread("account_specific", thread.url, priv.url);
        log.info("moved to private", { reason: "account_specific" });
      } catch (err) {
        log.error("private thread failed, falling back to handoff", { error: err instanceof Error ? err.name : "unknown" });
        opts.alert("qa_escalation_failed");
        await postHandoff(thread);
        opts.staffLog.needsStaff("account_specific_private_failed", thread.url);
      }
    },

    /** Staff clicked "Move to private" on a Needs Staff post. Throws on failure so the button handler can report it. */
    async moveToPrivate(thread: ThreadLike, member: Member): Promise<void> {
      if (privateBySource.has(thread.id)) throw new AlreadyPrivateError();
      const priv = await opts.createPrivateThread({
        reason: "staff_handoff",
        member,
        source: { postId: thread.id, url: thread.url },
      });
      rememberPrivate(thread.id, priv.url);
      await postPrivateNote(thread, priv.id);
      opts.staffLog.movedToPrivate(thread.url, priv.url);
      log.info("moved to private", { reason: "staff_button" });
    },
  };
}

export type Escalator = ReturnType<typeof createEscalator>;
