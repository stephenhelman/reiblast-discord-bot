/**
 * Decides whether the bot should answer a Discord event. Pure: the Discord adapter reduces a message / thread update
 * to the plain facts below, so every rule is testable without discord.js objects. Silent is the default; the bot
 * answers only for the triggers listed here.
 */
import type { Surface } from "./prompt.js";

/** The bot answers a thread at most this many times; the next follow-up escalates instead. */
export const MAX_BOT_TURNS = 10;

export interface TriggerConfig {
  tagSupportId: string;
  tagResolvedId: string;
  tagNeedsStaffId: string;
}

export type Where =
  /** A post (thread) inside the support forum. */
  | { kind: "forum-thread"; ownerId: string; appliedTags: readonly string[]; isStarter: boolean }
  /** The locked Support channel or a private thread under it: the bot never answers there. */
  | { kind: "support-channel" }
  /** Chat, Wins, any other channel or thread. */
  | { kind: "other" };

export interface MessageFacts {
  inGuild: boolean;
  authorId: string;
  /** Bots, webhooks, system messages, and this bot itself. */
  authorIsBot: boolean;
  authorIsStaff: boolean;
  /** A direct user mention of this bot (not a role, @everyone, or @here). */
  mentionsBot: boolean;
  /** There is something to answer once mention markup is stripped (a starter message may count its title). */
  hasText: boolean;
  where: Where;
}

export type Trigger = "new_post" | "tag_added" | "mention" | "followup";

export type IgnoreReason =
  | "not_guild"
  | "not_forum"
  | "bot_author"
  | "support_channel"
  | "empty"
  | "no_trigger"
  | "terminal_tag"
  | "staff_author"
  | "not_op"
  | "not_answered_yet"
  | "already_answered";

export type Decision =
  | { action: "ignore"; reason: IgnoreReason }
  /** The answer depends on how many times the bot has already posted in the thread, which isn't cached (e.g. after a restart). */
  | { action: "need_history" }
  | { action: "answer"; trigger: Trigger; surface: Surface; asker: "poster" | "other" }
  /** The thread has used up the bot's turns: treat it like not_covered. */
  | { action: "escalate"; reason: "turn_cap" };

const ignore = (reason: IgnoreReason): Decision => ({ action: "ignore", reason });

/**
 * @param botTurns messages the bot has already posted in this thread; undefined if not known yet (the result is then
 *   `need_history` whenever it matters — fetch the thread, count, and call again).
 */
export function decide(msg: MessageFacts, cfg: TriggerConfig, botTurns: number | undefined): Decision {
  if (!msg.inGuild) return ignore("not_guild");
  if (msg.authorIsBot) return ignore("bot_author");
  if (msg.where.kind === "support-channel") return ignore("support_channel");
  if (!msg.hasText) return ignore("empty");

  if (msg.where.kind === "other") {
    return msg.mentionsBot ? { action: "answer", trigger: "mention", surface: "chat", asker: "poster" } : ignore("no_trigger");
  }

  const { ownerId, appliedTags, isStarter } = msg.where;
  const terminal = appliedTags.includes(cfg.tagResolvedId) || appliedTags.includes(cfg.tagNeedsStaffId);
  const hasSupport = appliedTags.includes(cfg.tagSupportId);
  if (terminal) return ignore("terminal_tag");

  if (isStarter) {
    if (hasSupport) return { action: "answer", trigger: "new_post", surface: "forum", asker: "poster" };
    if (msg.mentionsBot) return { action: "answer", trigger: "mention", surface: "forum", asker: "poster" };
    return ignore("no_trigger");
  }

  if (msg.authorId === ownerId) {
    // Staff talking in their own post are staff, not a member asking for help — unless they mention the bot to test it.
    if (msg.authorIsStaff && !msg.mentionsBot) return ignore("staff_author");
    // Without the Support tag (staff removed it) this isn't a bot thread any more, unless explicitly mentioned.
    if (!hasSupport && !msg.mentionsBot) return ignore("no_trigger");
    if (botTurns === undefined) return { action: "need_history" };
    if (botTurns === 0) {
      return msg.mentionsBot ? { action: "answer", trigger: "mention", surface: "forum", asker: "poster" } : ignore("not_answered_yet");
    }
    if (botTurns >= MAX_BOT_TURNS) return { action: "escalate", reason: "turn_cap" };
    return { action: "answer", trigger: "followup", surface: "forum", asker: "poster" };
  }

  // Someone other than the poster: only an @mention in a post the bot hasn't answered yet.
  if (!msg.mentionsBot) return ignore("not_op");
  if (botTurns === undefined) return { action: "need_history" };
  if (botTurns > 0) return ignore("already_answered");
  return { action: "answer", trigger: "mention", surface: "forum", asker: "other" };
}

export interface TagChange {
  /** The thread is a post in the support forum. */
  inForum: boolean;
  oldTags: readonly string[];
  newTags: readonly string[];
}

/** The Support tag was added to an existing post. */
export function decideTagAdded(change: TagChange, cfg: TriggerConfig, botTurns: number | undefined): Decision {
  if (!change.inForum) return ignore("not_forum");
  if (!change.newTags.includes(cfg.tagSupportId) || change.oldTags.includes(cfg.tagSupportId)) return ignore("no_trigger");
  if (change.newTags.includes(cfg.tagResolvedId) || change.newTags.includes(cfg.tagNeedsStaffId)) return ignore("terminal_tag");
  if (botTurns === undefined) return { action: "need_history" };
  if (botTurns > 0) return ignore("already_answered");
  return { action: "answer", trigger: "tag_added", surface: "forum", asker: "poster" };
}
