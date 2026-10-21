/**
 * Manual helper: prints name + ID for each tag on DISCORD_SUPPORT_FORUM_ID, then exits. Run with `npm run list-forum-tags`.
 * Deliberately does not use loadConfig(): the tag IDs it prints are required by that config, so it must run without them.
 * This is the only place IDs are printed, and it is never part of the running bot.
 */
import { REST, Routes } from "discord.js";
import { z } from "zod";
import { ForumTagsError, formatForumTags } from "./forum-tags.js";

const env = z
  .object({
    DISCORD_BOT_TOKEN: z.string().trim().min(1),
    DISCORD_SUPPORT_FORUM_ID: z.string().regex(/^\d{15,25}$/),
  })
  .safeParse(process.env);

if (!env.success) {
  const names = [...new Set(env.error.issues.map((i) => i.path.join(".")))];
  console.error(`Set these in .env first: ${names.join(", ")}`);
  process.exit(1);
}

const rest = new REST().setToken(env.data.DISCORD_BOT_TOKEN);
try {
  const channel = (await rest.get(Routes.channel(env.data.DISCORD_SUPPORT_FORUM_ID))) as Parameters<typeof formatForumTags>[0];
  for (const line of formatForumTags(channel)) console.log(line);
} catch (err) {
  console.error(err instanceof ForumTagsError ? err.message : `Discord request failed (${err instanceof Error ? err.name : "unknown"}).`);
  process.exit(1);
}
