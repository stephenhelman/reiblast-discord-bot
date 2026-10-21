/**
 * The only place the Q&A feature sends channel messages. Everything goes through `allowedMentions()`, whose base
 * is `{ parse: [] }`: nothing the model writes (or a member makes it echo) can ping anyone. The only pings are on fixed
 * bot text, via `postFixedText`: exactly one role (the support role) and/or exactly one user (the member being
 * helped), on the first message. Model text has no way to request a ping.
 */
import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import { buildAnswerRow, buildHelpOnlyRow } from "./components.js";

export const DISCORD_MESSAGE_LIMIT = 2000;

export interface AllowedMentions {
  parse: [];
  /** Present only for the explicit support-role ping: exactly one role. */
  roles?: [string];
  /** Present only for the explicit ping of the member being helped: exactly one user. */
  users?: [string];
  /** Present (false) on replies, so replying never pings the member being replied to. */
  repliedUser?: false;
}

const SNOWFLAKE = /^\d{15,25}$/;

export function allowedMentions(opts: { pingRoleId?: string; pingUserId?: string; asReply?: boolean } = {}): AllowedMentions {
  for (const id of [opts.pingRoleId, opts.pingUserId]) {
    if (id !== undefined && !SNOWFLAKE.test(id)) throw new TypeError("ping target must be a Discord ID");
  }
  const out: AllowedMentions = { parse: [] };
  if (opts.pingRoleId) out.roles = [opts.pingRoleId];
  if (opts.pingUserId) out.users = [opts.pingUserId];
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

/**
 * Adapts a channel / thread (anything with `send`) to a PostTarget whose first part is a plain send. Lives here so
 * `.send(` appears nowhere else in the feature.
 */
export function threadTarget(channel: { send(message: OutgoingMessage): Promise<unknown> }): PostTarget {
  return { reply: (m) => channel.send(m), send: (m) => channel.send(m) };
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

interface SendOptions {
  components?: ActionRowBuilder<ButtonBuilder>[];
  pingRoleId?: string;
  pingUserId?: string;
  /** How the first part goes out: as a reply to the triggering message, or a plain send into the channel. */
  first: "reply" | "send";
}

async function sendParts(target: PostTarget, parts: string[], opts: SendOptions): Promise<number> {
  if (parts.length === 0) throw new TypeError("nothing to post");
  for (const [i, content] of parts.entries()) {
    const isFirst = i === 0;
    const message: OutgoingMessage = {
      content,
      // Pings ride on the first part only.
      allowedMentions: allowedMentions({
        asReply: isFirst && opts.first === "reply",
        pingRoleId: isFirst ? opts.pingRoleId : undefined,
        pingUserId: isFirst ? opts.pingUserId : undefined,
      }),
      ...(opts.components && i === parts.length - 1 ? { components: opts.components } : {}),
    };
    await (isFirst && opts.first === "reply" ? target.reply(message) : target.send(message));
  }
  return parts.length;
}

/**
 * Posts model-written text (an answer or a question). No ping is possible here. Buttons, if asked for, go on the last
 * part only: `true` = "That solved it" / "Still need help"; "help" = "Still need help" alone (under a guided question).
 * `marker` is a fixed counter line (see markers.ts) that code appends after the model text. Returns the number of
 * messages sent.
 */
export function postModelText(
  target: PostTarget,
  text: string,
  opts: { buttons?: boolean | "help"; marker?: string } = {},
): Promise<number> {
  const rows = opts.buttons === "help" ? [buildHelpOnlyRow()] : opts.buttons ? [buildAnswerRow()] : undefined;
  const body = opts.marker ? `${text.trimEnd()}\n${opts.marker}` : text;
  return sendParts(target, splitMessage(body), { first: "reply", components: rows });
}

/**
 * Posts fixed bot text (templates, notes). May ping exactly one role and/or exactly one user — the only pings the bot
 * ever sends — and may carry button rows (on the last part).
 */
export function postFixedText(
  target: PostTarget,
  text: string,
  opts: { pingRoleId?: string; pingUserId?: string; components?: ActionRowBuilder<ButtonBuilder>[]; first?: "reply" | "send" } = {},
): Promise<number> {
  return sendParts(target, splitMessage(text), {
    first: opts.first ?? "reply",
    pingRoleId: opts.pingRoleId,
    pingUserId: opts.pingUserId,
    components: opts.components,
  });
}
