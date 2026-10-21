/**
 * How the bot recognizes private threads it opened, with no storage. A thread is the bot's if it is a private thread
 * under the Support channel whose `ownerId` is the bot. Its member, source post and reason are read from the ref line
 * the bot writes at the end of its first message: `-# ref <reason> post:<id> member:<id>`.
 *
 * Verified against Discord (npm run verify-private-threads): ownerId survives archive + lock; a system "member added"
 * message authored by the bot comes BEFORE our first message, so the reader scans the oldest messages for the ref line
 * instead of taking the oldest message.
 */
import { ChannelType } from "discord.js";

export type PrivateThreadReason = "staff_handoff" | "account_check";

export interface ThreadRef {
  reason: PrivateThreadReason;
  /** The forum post the conversation came from. */
  postId: string;
  /** The member being helped. */
  memberId: string;
}

const REF_LINE = /^-# ref (staff_handoff|account_check) post:(\d{15,25}) member:(\d{15,25})$/;

export function formatRef(ref: ThreadRef): string {
  return `-# ref ${ref.reason} post:${ref.postId} member:${ref.memberId}`;
}

/** Parses a ref from message content: the first line that is exactly a ref line. */
export function parseRef(content: string): ThreadRef | null {
  for (const line of content.split("\n")) {
    const m = REF_LINE.exec(line.trimEnd());
    if (m) return { reason: m[1] as PrivateThreadReason, postId: m[2]!, memberId: m[3]! };
  }
  return null;
}

export interface RefMessage {
  authorId: string;
  content: string;
  /** Discord system messages, including the "added to thread" one the bot itself authors. */
  system?: boolean;
}

/** From messages oldest-first, the ref in the first non-system message the bot wrote that carries one. */
export function findRef(messages: readonly RefMessage[], botId: string): ThreadRef | null {
  for (const m of messages) {
    if (m.system || m.authorId !== botId) continue;
    const ref = parseRef(m.content);
    if (ref) return ref;
  }
  return null;
}

/** Cheap synchronous test on cached channel properties: a private thread under the Support channel, owned by the bot. */
export function isBotPrivateThread(
  t: { type: ChannelType; ownerId: string | null; parentId: string | null },
  botId: string,
  supportChannelId: string,
): boolean {
  return t.type === ChannelType.PrivateThread && t.ownerId === botId && t.parentId === supportChannelId;
}

/** How many of a thread's oldest messages to scan for the ref line. */
export const REF_SCAN_LIMIT = 20;

/**
 * Looks a thread's ref up once and remembers the answer, including "none" (staff deleted the message, or not ours).
 * `fetchOldest` returns the thread's oldest messages, oldest first.
 */
export function createRefReader(opts: { botId: string; fetchOldest: (threadId: string) => Promise<RefMessage[]> }) {
  const memo = new Map<string, ThreadRef | null>();
  return {
    /** Record a ref at creation time, so the first lookup never has to fetch. */
    remember(threadId: string, ref: ThreadRef): void {
      memo.set(threadId, ref);
    },
    async read(threadId: string): Promise<ThreadRef | null> {
      if (memo.has(threadId)) return memo.get(threadId) ?? null;
      const ref = findRef(await opts.fetchOldest(threadId), opts.botId);
      memo.set(threadId, ref);
      return ref;
    },
  };
}

export type RefReader = ReturnType<typeof createRefReader>;
