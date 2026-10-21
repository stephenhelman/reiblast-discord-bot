/**
 * discord.js ⇄ Q&A glue. Everything here is mapping: Message → QaMessage, thread → ThreadMessage[], button interactions →
 * the handlers' structural types, plus a startup check that the configured IDs and permissions are usable.
 * Nothing in this file decides anything; outgoing messages pass through unchanged (they already carry allowedMentions).
 */
import {
  ChannelType,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type Message,
  type ThreadChannel,
} from "discord.js";
import { hasRole } from "../verify/setup.js";
import type { AnswerButtonInteractionLike } from "../qa/buttons.js";
import { cleanContent, type ThreadMessage } from "../qa/history.js";
import type { QaMessage } from "../qa/handler.js";
import type { PostTarget } from "../qa/post.js";
import type { StaffButtonInteractionLike } from "../qa/staff-buttons.js";
import { REF_SCAN_LIMIT, type RefMessage } from "../qa/threadref.js";
import type { MessageFacts, TriggerConfig, Where } from "../qa/triggers.js";

export interface QaIds {
  guildId: string;
  forumId: string;
  supportChannelId: string;
  staffRoleId: string;
  supportRoleId: string;
  tags: TriggerConfig;
}

const byId = <T extends { id: string }>(a: T, b: T) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1);

/** Up to 100 latest messages plus the starter, oldest first. Beyond 100 the bot's turn cap has long since escalated. */
export async function fetchThreadMessages(thread: ThreadChannel): Promise<ThreadMessage[]> {
  const batch = [...(await thread.messages.fetch({ limit: 100 })).values()];
  if (!batch.some((m) => m.id === thread.id)) {
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) batch.push(starter);
  }
  return batch.sort(byId).map((m) => ({ id: m.id, authorId: m.author.id, content: m.content, system: m.system }));
}

/** For the ref reader: a thread's oldest messages (the ref line is in our first message, after a system "added" message). */
export function createFetchOldest(client: Client): (threadId: string) => Promise<RefMessage[]> {
  return async (threadId) => {
    const channel = await client.channels.fetch(threadId);
    if (!channel?.isThread()) return [];
    const oldest = [...(await channel.messages.fetch({ after: "0", limit: REF_SCAN_LIMIT })).values()].sort(byId);
    return oldest.map((m) => ({ authorId: m.author.id, content: m.content, system: m.system }));
  };
}

function whereOf(message: Message, ids: QaIds): Where {
  const channel = message.channel;
  if (channel.isThread()) {
    if (channel.parentId === ids.supportChannelId) return { kind: "support-channel" };
    if (channel.parentId === ids.forumId) {
      return { kind: "forum-thread", ownerId: channel.ownerId ?? "", appliedTags: channel.appliedTags, isStarter: message.id === channel.id };
    }
    return { kind: "other" };
  }
  return channel.id === ids.supportChannelId ? { kind: "support-channel" } : { kind: "other" };
}

/** Maps a discord.js message to the orchestrator's input. Returns null for what can never be a trigger. */
export function toQaMessage(message: Message, ids: QaIds, botId: string): QaMessage | null {
  if (message.partial || !message.channel.isSendable()) return null;
  const channel = message.channel;
  const where = whereOf(message, ids);
  const thread = where.kind === "forum-thread" && channel.isThread() ? channel : null;
  const title = thread?.name;

  const text = cleanContent(message.content, botId);
  const facts: MessageFacts = {
    inGuild: message.inGuild() && message.guildId === ids.guildId,
    authorId: message.author.id,
    authorIsBot: message.author.bot || message.webhookId !== null || message.system || message.author.id === botId,
    authorIsStaff: hasRole(message.member, ids.staffRoleId) || hasRole(message.member, ids.supportRoleId),
    mentionsBot: new RegExp(`<@!?${botId}>`).test(message.content),
    // A post always has a title, so a title-only starter still has something to answer.
    hasText: text.length > 0 || (where.kind === "forum-thread" && where.isStarter && !!title),
    where,
  };

  const target: PostTarget = { reply: (m) => message.reply(m), send: (m) => channel.send(m) };
  return {
    id: message.id,
    content: message.content,
    author: { id: message.author.id, displayName: message.member?.displayName ?? message.author.displayName },
    facts,
    thread,
    title,
    channelId: channel.id,
    target,
    fetchThreadMessages: () => (thread ? fetchThreadMessages(thread) : Promise.resolve([])),
    sendTyping: () => channel.sendTyping(),
  };
}

/** The first message of a forum post as a QaMessage (for "Support tag added later"). */
export async function loadStarter(thread: ThreadChannel, ids: QaIds, botId: string): Promise<QaMessage | null> {
  const starter = await thread.fetchStarterMessage().catch(() => null);
  return starter ? toQaMessage(starter, ids, botId) : null;
}

export function toAnswerButton(i: ButtonInteraction): AnswerButtonInteractionLike {
  return {
    customId: i.customId,
    user: i.user,
    member: i.member,
    channel: i.channel?.isThread() ? i.channel : null,
    deferUpdate: () => i.deferUpdate(),
    editReply: (o) => i.editReply(o),
    followUp: (o) => i.followUp(o),
    reply: (o) => i.reply(o),
  };
}

export function toStaffButton(i: ButtonInteraction): StaffButtonInteractionLike {
  return {
    customId: i.customId,
    user: i.user,
    member: i.member,
    channel: i.channel?.isThread() ? i.channel : null,
    deferUpdate: () => i.deferUpdate(),
    editReply: (o) => i.editReply(o),
    followUp: (o) => i.followUp(o),
    reply: (o) => i.reply(o),
  };
}

/**
 * Startup check: returns problem codes (static strings, no IDs). Catches the quiet failures — wrong tag IDs, a role
 * that isn't mentionable, missing permissions — before the first member hits them.
 */
export async function checkQaSetup(client: Client, ids: QaIds): Promise<string[]> {
  const problems: string[] = [];
  const guild = await client.guilds.fetch(ids.guildId).catch(() => null);
  if (!guild) return ["guild_not_found"];
  const fetched = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!fetched) return ["bot_member_not_found"];
  const me: GuildMember = fetched;

  const need = (channel: { permissionsFor(m: GuildMember): { has(p: bigint): boolean } | null }, label: string, perms: Array<[string, bigint]>) => {
    const granted = channel.permissionsFor(me);
    for (const [name, bit] of perms) if (!granted?.has(bit)) problems.push(`${label}_missing_${name}`);
  };

  const forum = await client.channels.fetch(ids.forumId).catch(() => null);
  if (!forum) problems.push("forum_not_found");
  else if (forum.type !== ChannelType.GuildForum) problems.push("forum_wrong_type");
  else {
    const tagIds = new Set(forum.availableTags.map((t) => t.id));
    for (const [name, id] of [["support", ids.tags.tagSupportId], ["resolved", ids.tags.tagResolvedId], ["needs_staff", ids.tags.tagNeedsStaffId]] as const) {
      if (!tagIds.has(id)) problems.push(`tag_${name}_not_in_forum`);
    }
    need(forum, "forum", [
      ["view", PermissionFlagsBits.ViewChannel],
      ["send_in_posts", PermissionFlagsBits.SendMessagesInThreads],
      ["read_history", PermissionFlagsBits.ReadMessageHistory],
      ["manage_threads", PermissionFlagsBits.ManageThreads],
    ]);
  }

  const support = await client.channels.fetch(ids.supportChannelId).catch(() => null);
  if (!support) problems.push("support_channel_not_found");
  else if (support.type !== ChannelType.GuildText) problems.push("support_channel_wrong_type");
  else {
    need(support, "support_channel", [
      ["view", PermissionFlagsBits.ViewChannel],
      ["create_private_threads", PermissionFlagsBits.CreatePrivateThreads],
      ["send_in_threads", PermissionFlagsBits.SendMessagesInThreads],
      ["manage_threads", PermissionFlagsBits.ManageThreads],
    ]);
  }

  const role = await guild.roles.fetch(ids.supportRoleId).catch(() => null);
  if (!role) problems.push("support_role_not_found");
  else if (!role.mentionable) {
    // The bot's ping is limited to this one role; Discord only delivers it if the role allows @mentions.
    problems.push("support_role_not_mentionable");
  }
  return problems;
}
