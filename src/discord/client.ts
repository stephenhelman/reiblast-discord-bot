import { Client, GatewayIntentBits } from "discord.js";
import { createLogger } from "../logger.js";

const log = createLogger("discord");

/**
 * Intents: Guilds, GuildMembers (privileged — role grants), GuildMessages and MessageContent (privileged — the Q&A feature
 * reads questions). The client-wide allowedMentions default is a safety net: nothing pings unless a message explicitly asks.
 */
export function createDiscordClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    allowedMentions: { parse: [] },
  });

  client.once("clientReady", (c) => log.info("gateway ready", { guilds: c.guilds.cache.size }));
  client.on("error", (err) => log.error("client error", { message: err.message }));
  client.on("shardDisconnect", (ev, id) => log.warn("shard disconnected", { shard: id, code: ev.code }));
  client.on("shardReconnecting", (id) => log.warn("shard reconnecting", { shard: id }));

  return client;
}
