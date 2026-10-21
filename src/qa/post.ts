/**
 * The only place the Q&A feature sends channel messages. Everything goes through `allowedMentions()`, whose base
 * is `{ parse: [] }`: nothing the model writes (or a member makes it echo) can ping anyone. The single exception is an
 * explicit support-role ping on a fixed escalation message, which only `postFixedText` can request — model text can't.
 */
import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import { buildAnswerRow } from "./components.js";

export const DISCORD_MESSAGE_LIMIT = 2000;

export interface AllowedMentions {
  parse: [];
  /** Present only for the explicit support-role ping. */
  roles?: string[];
  /** Present (false) on replies, so replying never pings the member being replied to. */
  repliedUser?: false;
}

export function allowedMentions(opts: { pingRoleId?: string; asReply?: boolean } = {}): AllowedMentions {
  const out: AllowedMentions = { parse: [] };
  if (opts.pingRoleId) out.roles = [opts.pingRoleId];
  if (opts.asReply) out.repliedUser = false;
  return out;
}

export interface OutgoingMessage {
  content: string;
  components?: ActionRowBuilder<ButtonBuilder>[];
  /** Required on every message, so nothing can be sent with Discord's default (ping everything) behavior. */
  allowedMentions: AllowedMentions;
}

/** What the Discord adapter provides: reply to the triggering message, and send follow-up parts in the same channel. */
export interface PostTarget {
  reply(message: OutgoingMessage): Promise<unknown>;
  send(message: OutgoingMessage): Promise<unknown>;
}

/** Splits at paragraph, then line, then space boundaries; hard-cuts only a single unbroken run. Never returns empties. */
export function splitMessage(text: string, limit: number = DISCORD_MESSAGE_LIMIT): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= limit) return clean ? [clean] : [];

  const pieces: string[] = [];
  for (const paragraph of clean.split(/\n{2,}/)) {
    let rest = paragraph.trim();
    while (rest.length > limit) {
      const window = rest.slice(0, limit + 1);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
      const at = cut > 0 ? cut : limit;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }

  const parts: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const joined = current ? `${current}\n\n${piece}` : piece;
    if (joined.length <= limit) current = joined;
    else {
      parts.push(current);
      current = piece;
    }
  }
  if (current) parts.push(current);
  return parts.filter(Boolean);
}

async function sendParts(target: PostTarget, parts: string[], opts: { buttons: boolean; pingRoleId?: string }): Promise<number> {
  if (parts.length === 0) throw new TypeError("nothing to post");
  for (const [i, content] of parts.entries()) {
    const message: OutgoingMessage = {
      content,
      allowedMentions: allowedMentions({ asReply: i === 0, pingRoleId: i === 0 ? opts.pingRoleId : undefined }),
      ...(opts.buttons && i === parts.length - 1 ? { components: [buildAnswerRow()] } : {}),
    };
    await (i === 0 ? target.reply(message) : target.send(message));
  }
  return parts.length;
}

/**
 * Posts model-written text (an answer or a clarifying question). No role ping is possible here. Buttons, if asked for,
 * go on the last part only. Returns the number of messages sent.
 */
export function postModelText(target: PostTarget, text: string, opts: { buttons?: boolean } = {}): Promise<number> {
  return sendParts(target, splitMessage(text), { buttons: opts.buttons ?? false });
}

/** Posts fixed bot text (templates, notes). Optionally pings the support role — the only ping the bot ever sends. */
export function postFixedText(target: PostTarget, text: string, opts: { pingRoleId?: string } = {}): Promise<number> {
  return sendParts(target, splitMessage(text), { buttons: false, pingRoleId: opts.pingRoleId });
}
