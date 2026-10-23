/**
 * The Q&A orchestrator: decide → rate limit → coalesce → history → answer → post → buttons / escalate, for the forum
 * and chat surfaces. Discord-free: the adapter (src/discord/qa-adapter.ts) turns discord.js objects into `QaMessage`.
 * Logs carry reason / outcome codes and counts only — never message content, names or IDs.
 */
import { createLogger, type Logger } from "../logger.js";
import type { AnswerResult, Answerer, QaFailure } from "./answer.js";
import type { ThreadLike } from "./buttons.js";
import type { EscalationReason, Escalator } from "./escalate.js";
import type { Intake, IntakeKnown } from "./intake.js";
import { buildSingleTurn, buildThreadHistory, lastQuestionMessageId, type ThreadMessage } from "./history.js";
import type { Coalescer, RateLimiter } from "./limits.js";
import { QA_TEXT } from "./messages.js";
import { postFixedText, postModelText, type PostTarget } from "./post.js";
import { CLARIFY_MARKER, diagnoseMarker } from "./markers.js";
import { NO_PROGRESS, type QuestionProgress } from "./progress.js";
import type { ThreadStateStore } from "./state.js";
import {
  decide,
  decideTagAdded,
  type Decision,
  type MessageFacts,
  type TagChange,
  type TriggerConfig,
} from "./triggers.js";

export interface QaMessage {
  id: string;
  /** The message text as written (never logged). */
  content: string;
  author: { id: string; displayName: string };
  facts: MessageFacts;
  /** The forum post, when `facts.where.kind === "forum-thread"`. */
  thread: ThreadLike | null;
  /** The forum post's title, joined to the starter message in history. */
  title?: string;
  channelId: string;
  /** reply = to this message; send = a follow-up in the same channel. */
  target: PostTarget;
  /** The post's messages (oldest first), forum only. */
  fetchThreadMessages(): Promise<ThreadMessage[]>;
  /** Removes the buttons from one of the bot's earlier messages in this thread. */
  clearButtons(messageId: string): Promise<void>;
  sendTyping(): Promise<void>;
}

type Answer = Extract<Decision, { action: "answer" }>;

export function createQaHandler(opts: {
  botId: string;
  tags: TriggerConfig;
  answer: Answerer;
  limiter: RateLimiter;
  state: ThreadStateStore;
  coalesce: Coalescer;
  escalator: Pick<Escalator, "handoff" | "accountSpecific">;
  /** Decides whether a hand-off gets the case summary and intake ask (troubleshooting threads only). */
  intake: Pick<Intake, "contextFor">;
  alert: (code: string) => void;
  logger?: Logger;
}) {
  const log = opts.logger ?? createLogger("qa");
  const { botId, tags, state } = opts;

  async function countBotTurns(m: QaMessage): Promise<number> {
    const messages = await m.fetchThreadMessages();
    const n = messages.filter((x) => x.authorId === botId && !x.system).length;
    state.seed(m.thread!.id, n);
    return n;
  }

  async function safePost(what: "answer" | "note" | "pointer", send: () => Promise<unknown>): Promise<boolean> {
    try {
      await send();
      return true;
    } catch (err) {
      log.error("post failed", { what, error: err instanceof Error ? err.name : "unknown" });
      opts.alert("qa_post_failed");
      return false;
    }
  }

  /**
   * The bot has just posted its next message: take "Still need help" off its previous question. Best effort: a failed edit
   * never blocks anything and logs a code only.
   */
  async function clearPreviousQuestion(m: QaMessage, previousQuestionId: string | undefined): Promise<void> {
    if (!previousQuestionId) return;
    try {
      await m.clearButtons(previousQuestionId);
    } catch {
      log.warn("previous question button not cleared", { code: "button_clear_failed" });
    }
  }

  async function deliver(
    result: AnswerResult,
    surface: "forum" | "chat",
    m: QaMessage,
    question: string,
    progress: QuestionProgress,
    previousQuestionId: string | undefined,
    known: IntakeKnown,
  ): Promise<void> {
    const forum = surface === "forum";
    const thread = m.thread;
    const pointer = () => safePost("pointer", () => postFixedText(m.target, QA_TEXT.chatPointer));

    if (!result.ok) {
      const reason: EscalationReason = `qa_${result.reason satisfies QaFailure}`;
      if (forum && thread) {
        // The model is failing, so don't spend another call on a summary: use what is remembered, if anything.
        const intake = await opts.intake.contextFor(thread, { ...known, allowRegenerate: false });
        await opts.escalator.handoff(thread, reason, intake);
        state.recordPost(thread.id, "other");
        await clearPreviousQuestion(m, previousQuestionId);
      } else {
        opts.alert(reason); // chat: nothing to escalate, but staff still learn the model is failing
        await pointer();
      }
      return;
    }

    switch (result.outcome) {
      case "answered":
        if (await safePost("answer", () => postModelText(m.target, result.reply, { buttons: forum }))) {
          if (thread) {
            state.recordPost(thread.id, "answered");
            await clearPreviousQuestion(m, previousQuestionId);
          }
        }
        return;
      case "clarify":
        // The counter marker is how the thread remembers this question (forum only; chat has no thread).
        if (await safePost("answer", () => postModelText(m.target, result.reply, { marker: thread ? CLARIFY_MARKER : undefined }))) {
          if (thread) {
            state.recordPost(thread.id, "clarify");
            await clearPreviousQuestion(m, previousQuestionId);
          }
        }
        return;
      case "diagnose":
        // One guided question, numbered, with only "Still need help" so a stuck member can bail out to staff.
        if (
          await safePost("answer", () =>
            postModelText(m.target, result.reply, { buttons: "help", marker: diagnoseMarker(progress.diagnoseAsked + 1) }),
          )
        ) {
          if (thread) {
            state.recordPost(thread.id, "diagnose");
            await clearPreviousQuestion(m, previousQuestionId);
          }
        }
        return;
      case "not_covered":
        if (forum && thread) {
          const intake = await opts.intake.contextFor(thread, { ...known, summary: result.summary });
          await opts.escalator.handoff(thread, "not_covered", intake);
          state.recordPost(thread.id, "other");
          await clearPreviousQuestion(m, previousQuestionId);
        } else await pointer();
        return;
      case "account_specific":
        if (forum && thread) {
          const intake = await opts.intake.contextFor(thread, { ...known, summary: result.summary });
          await opts.escalator.accountSpecific(thread, m.author, question, intake);
          state.recordPost(thread.id, "other");
          await clearPreviousQuestion(m, previousQuestionId);
        } else await pointer();
        return;
    }
  }

  async function runAnswer(d: Answer, m: QaMessage): Promise<void> {
    m.sendTyping().catch(() => {});
    const thread = m.thread;
    let turns;
    let progress: QuestionProgress = NO_PROGRESS;
    let previousQuestionId: string | undefined;
    let known: IntakeKnown = {};
    if (d.surface === "forum" && thread) {
      const messages = await m.fetchThreadMessages();
      const h = buildThreadHistory(messages, {
        botId,
        opId: thread.ownerId ?? "",
        threadId: thread.id,
        title: m.title,
        trigger: { id: m.id, authorId: m.author.id, content: m.content },
      });
      state.seed(thread.id, h.botTurns);
      turns = h.turns;
      progress = h.progress; // re-derived from the thread's counter markers, so it survives a restart
      previousQuestionId = h.previousQuestionId;
      known = { messages, diagnoseTurns: h.diagnoseTurns };
    } else {
      turns = buildSingleTurn(m.content, botId);
    }

    const result = await opts.answer({
      history: turns,
      surface: d.surface,
      progress,
    });
    // Kept in memory for a hand-off that has no model call of its own (a button click, the turn cap).
    if (result.ok && thread && d.surface === "forum") state.setSummary(thread.id, result.summary);
    log.info("handled", {
      trigger: d.trigger,
      surface: d.surface,
      outcome: result.ok ? result.outcome : `failed_${result.reason}`,
    });
    // The "question" quoted to staff in a private thread. In a walk-through the last message is just an answer to one of the
    // bot's questions ("Yes it is above zero"), so quote the original post instead; otherwise the message that triggered this.
    const troubleshooting = (known.diagnoseTurns ?? 0) > 0;
    const question = (troubleshooting ? turns.find((t) => t.role === "user")?.text : turns.at(-1)?.text) ?? "";
    await deliver(result, d.surface, m, question, progress, previousQuestionId, known);
  }

  async function dispatch(d: Decision, m: QaMessage): Promise<void> {
    switch (d.action) {
      case "ignore":
        log.debug("ignored", { reason: d.reason });
        return;
      case "need_history":
        return; // resolved by the callers before dispatch
      case "escalate":
        if (m.thread) {
          // No history was fetched on this path: get it once, for the intake context and the previous question.
          const messages = await m.fetchThreadMessages().catch(() => undefined);
          const intake = await opts.intake.contextFor(m.thread, messages ? { messages } : {});
          await opts.escalator.handoff(m.thread, "turn_cap", intake);
          state.recordPost(m.thread.id, "other");
          await clearPreviousQuestion(m, messages ? lastQuestionMessageId(messages.filter((x) => x.id !== m.id), botId) : undefined);
        }
        return;
      case "answer": {
        const limit = opts.limiter.take(m.author.id);
        if (!limit.allowed) {
          log.info("rate limited", { surface: d.surface, notified: limit.notify });
          // One polite note per window in the forum; silent in chat.
          if (limit.notify && d.surface === "forum" && (await safePost("note", () => postFixedText(m.target, QA_TEXT.rateLimited)))) {
            if (m.thread) state.recordPost(m.thread.id, "other");
          }
          return;
        }
        const key = d.surface === "forum" && m.thread ? `thread:${m.thread.id}` : `chat:${m.channelId}:${m.author.id}`;
        await opts.coalesce(key, () => runAnswer(d, m));
        return;
      }
    }
  }

  return {
    /** A new message anywhere in the guild. */
    async handleMessage(m: QaMessage): Promise<void> {
      let d = decide(m.facts, tags, m.thread ? state.get(m.thread.id)?.botTurns : undefined);
      if (d.action === "need_history") d = decide(m.facts, tags, await countBotTurns(m));
      await dispatch(d, m);
    },

    /** A forum post's tags changed. `loadStarter` fetches the post's first message only if we might answer. */
    async handleTagAdded(args: { threadId: string; change: TagChange; loadStarter: () => Promise<QaMessage | null> }): Promise<void> {
      let d = decideTagAdded(args.change, tags, state.get(args.threadId)?.botTurns);
      if (d.action === "ignore") {
        log.debug("ignored", { reason: d.reason });
        return;
      }
      const m = await args.loadStarter();
      if (!m) return;
      if (d.action === "need_history") d = decideTagAdded(args.change, tags, await countBotTurns(m));
      await dispatch(d, m);
    },
  };
}

export type QaHandler = ReturnType<typeof createQaHandler>;
