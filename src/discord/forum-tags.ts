import { ChannelType } from "discord.js";

/** The slice of a REST channel object we read. */
interface RestChannel {
  type: number;
  name?: string;
  available_tags?: Array<{ id: string; name: string }>;
}

export class ForumTagsError extends Error {}

/** One `name<TAB>id` line per tag. Throws if the channel isn't a forum or has no tags. */
export function formatForumTags(channel: RestChannel): string[] {
  if (channel.type !== ChannelType.GuildForum) {
    throw new ForumTagsError("DISCORD_SUPPORT_FORUM_ID is not a forum channel.");
  }
  const tags = channel.available_tags ?? [];
  if (tags.length === 0) throw new ForumTagsError("The forum has no tags. Create Support, Resolved and Needs Staff first.");
  return tags.map((t) => `${t.name}\t${t.id}`);
}
