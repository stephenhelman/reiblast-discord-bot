import type { HistoryTurn } from "./prompt.js";

/** A message fetched from a thread, reduced to what history needs. Never logged. */
export interface ThreadMessage {
  id: string;
  authorId: string;
  content: string;
  /** Discord system messages (pins, joins, ...). */
  system?: boolean;
}

export interface HistoryContext {
  botId: string;
  /** The original poster (thread owner). */
  opId: string;
  threadId: string;
  /** The forum post title; joins the starter message, since members often put the question there. */
  title?: string;
  /** The message that triggered this answer. It always becomes the final user turn, whoever wrote it. */
  trigger: ThreadMessage;
}

export interface ThreadHistory {
  turns: HistoryTurn[];
  /** How many messages the bot has already posted in the thread (excluding the trigger). */
  botTurns: number;
}

/** Bot mention removed; other mentions replaced with a neutral token so raw IDs never reach the model. */
export function cleanContent(content: string, botId: string): string {
  return content
    .replace(new RegExp(`<@!?${botId}>`, "g"), "")
    .replace(/<@!?\d+>/g, "[mention]")
    .replace(/<@&\d+>/g, "[role mention]")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function withTitle(title: string | undefined, text: string): string {
  const t = title?.trim();
  if (!t) return text;
  return text ? `Title: ${t}\n\n${text}` : `Title: ${t}`;
}

/**
 * Builds model history from a thread: only the poster's messages and the bot's own, oldest first, ending with the
 * trigger message. Staff, other members, other bots, and system messages are left out.
 *
 * @param messages the thread's messages, oldest first (the trigger may be among them; it is placed last regardless)
 */
export function buildThreadHistory(messages: readonly ThreadMessage[], ctx: HistoryContext): ThreadHistory {
  const turns: HistoryTurn[] = [];
  let botTurns = 0;

  for (const m of messages) {
    if (m.system || m.id === ctx.trigger.id) continue;
    if (m.authorId === ctx.botId) {
      botTurns += 1;
      const text = cleanContent(m.content, ctx.botId);
      if (text) turns.push({ role: "assistant", text });
    } else if (m.authorId === ctx.opId) {
      const body = cleanContent(m.content, ctx.botId);
      const text = m.id === ctx.threadId ? withTitle(ctx.title, body) : body;
      if (text) turns.push({ role: "user", text });
    }
  }

  const body = cleanContent(ctx.trigger.content, ctx.botId);
  turns.push({ role: "user", text: ctx.trigger.id === ctx.threadId ? withTitle(ctx.title, body) : body });
  return { turns, botTurns };
}

/** History for a message outside a thread (Chat, Wins): just the message. */
export function buildSingleTurn(content: string, botId: string): HistoryTurn[] {
  return [{ role: "user", text: cleanContent(content, botId) }];
}
