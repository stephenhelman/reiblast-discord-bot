import { ChannelType } from "discord.js";
import { createLogger, type Logger } from "../logger.js";
import { buildCloseRow } from "./components.js";
import { postFixedText, threadTarget, type OutgoingMessage } from "./post.js";
import { formatRef, type PrivateThreadReason, type RefReader } from "./threadref.js";

/** Auto-archive after 3 days of inactivity (minutes). */
export const AUTO_ARCHIVE_MINUTES = 4320;
export const QUESTION_QUOTE_MAX = 900;
const NAME_MAX = 90;

export interface PrivateThreadHandle {
  id: string;
  url: string;
  members: { add(userId: string): Promise<unknown> };
  send(message: OutgoingMessage): Promise<unknown>;
  delete(reason?: string): Promise<unknown>;
}

/**
 * The Support channel. Deliberately has no `send`: the bot only ever creates threads under it, never posts top-level
 * (it is locked for members, and holds pinned instructions the bot must not touch).
 */
export interface PrivateThreadParent {
  threads: {
    create(options: {
      name: string;
      type: ChannelType.PrivateThread;
      invitable: false;
      autoArchiveDuration: typeof AUTO_ARCHIVE_MINUTES;
      reason: string;
    }): Promise<PrivateThreadHandle>;
  };
}

export interface PrivateThreadRequest {
  /** "staff_handoff" now; "account_check" is reserved for the later read-only account check. */
  reason: PrivateThreadReason;
  member: { id: string; displayName: string };
  /** The forum post the conversation came from. */
  source: { postId: string; url: string };
  /** The member's question, quoted so nobody has to retype it. Never logged. */
  question?: string;
}

export type PrivateThreadStep = "parent" | "create" | "add_member" | "first_message";

export class PrivateThreadError extends Error {
  constructor(readonly step: PrivateThreadStep) {
    super(`private thread failed at ${step}`);
  }
}

/** Display names are user-controlled: strip mentions, markdown-ish control characters, newlines; keep it short. */
export function threadName(displayName: string): string {
  const clean = displayName
    .replace(/<[@#][!&]?\d+>/g, "")
    .replace(/[\r\n\t\u0000-\u001f]+/g, " ")
    .replace(/[@#`*_~|>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `Support · ${(clean || "member").slice(0, NAME_MAX - 10)}`;
}

/** The member's text as a blockquote (so it can never form a ref line), mention markup neutralized, truncated. */
export function quoteQuestion(question: string): string {
  const flat = question
    .replace(/<@!?\d+>/g, "[mention]")
    .replace(/<@&\d+>/g, "[role mention]")
    .replace(/\r\n/g, "\n")
    .trim();
  const clipped = flat.length > QUESTION_QUOTE_MAX ? `${flat.slice(0, QUESTION_QUOTE_MAX).trimEnd()}…` : flat;
  return clipped
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function firstMessage(req: PrivateThreadRequest, pingRole: boolean, supportRoleId: string): string {
  const mentions = `${pingRole ? `<@&${supportRoleId}> ` : ""}<@${req.member.id}>`;
  const parts = [`${mentions}\nContinuing from the forum post: <${req.source.url}>`];
  if (req.question?.trim()) parts.push(`Your question:\n${quoteQuestion(req.question)}`);
  parts.push("A team member will take it from here.");
  parts.push(formatRef({ reason: req.reason, postId: req.source.postId, memberId: req.member.id }));
  return parts.join("\n\n");
}

/**
 * Opens a private thread under the Support channel, adds the member, and posts the first message: pings the member
 * (and, for staff handoffs, the support role), links the source post, quotes the question, and ends with the ref line
 * that lets the thread be recognized after a restart. If any step after creation fails, the half-built thread is deleted.
 *
 * Reusable by reason: "staff_handoff" now, "account_check" later.
 */
export function createPrivateThreadCreator(opts: {
  getParent: () => Promise<PrivateThreadParent | null>;
  supportRoleId: string;
  refs?: Pick<RefReader, "remember">;
  logger?: Logger;
}) {
  const log = opts.logger ?? createLogger("private-thread");

  return async function createPrivateThread(req: PrivateThreadRequest): Promise<{ id: string; url: string }> {
    const parent = await opts.getParent();
    if (!parent) throw new PrivateThreadError("parent");

    let thread: PrivateThreadHandle;
    try {
      thread = await parent.threads.create({
        name: threadName(req.member.displayName),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: AUTO_ARCHIVE_MINUTES,
        reason: `Private thread (${req.reason})`,
      });
    } catch (err) {
      log.error("create failed", { reason: req.reason, error: err instanceof Error ? err.name : "unknown" });
      throw new PrivateThreadError("create");
    }

    let step: PrivateThreadStep = "add_member";
    try {
      await thread.members.add(req.member.id);
      step = "first_message";
      const pingRole = req.reason === "staff_handoff";
      await postFixedText(threadTarget(thread), firstMessage(req, pingRole, opts.supportRoleId), {
        first: "send",
        pingUserId: req.member.id,
        pingRoleId: pingRole ? opts.supportRoleId : undefined,
        components: [buildCloseRow()],
      });
    } catch (err) {
      log.error("private thread setup failed", { reason: req.reason, step, error: err instanceof Error ? err.name : "unknown" });
      try {
        await thread.delete("Cleaning up half-built private thread");
      } catch {
        log.warn("cleanup of half-built thread failed", { reason: req.reason });
      }
      throw new PrivateThreadError(step);
    }

    opts.refs?.remember(thread.id, { reason: req.reason, postId: req.source.postId, memberId: req.member.id });
    log.info("private thread opened", { reason: req.reason });
    return { id: thread.id, url: thread.url };
  };
}

export type PrivateThreadCreator = ReturnType<typeof createPrivateThreadCreator>;
