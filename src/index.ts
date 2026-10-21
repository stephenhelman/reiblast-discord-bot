import { loadConfig } from "./config.js";
import { createDiscordClient } from "./discord/client.js";
import { createQa, loadQaKb } from "./discord/qa-setup.js";
import { registerInteractionHandlers } from "./discord/interactions.js";
import { createStaffAlerter, createStaffLogSender } from "./discord/staff-alert.js";
import { buildApp, closeHttpServer, startHttpServer } from "./http/server.js";
import { KbError } from "./kb/load.js";
import { createLogger } from "./logger.js";
import { createRoleGranter } from "./roles/grant.js";
import { createRoleRevoker } from "./roles/revoke.js";
import { createServerClient } from "./server-client/client.js";
import { createVerifyFlow } from "./verify/flow.js";
import { loadRules } from "./verify/rules.js";
import { createSessionStore } from "./verify/session.js";
import { createSetupHandler } from "./verify/setup.js";
import { createUnlinkHandler } from "./verify/unlink.js";

const config = loadConfig();
process.env.LOG_LEVEL = config.LOG_LEVEL;
const log = createLogger("boot");

// Fail fast and clearly if the rules file is missing or too long for one message.
let rules: string[];
try {
  rules = loadRules();
} catch (err) {
  log.error(err instanceof Error ? err.message : "could not load rules");
  process.exit(1);
}

// Fail fast and clearly if the knowledge base is invalid (file:line problems only, never KB text).
let kb;
try {
  kb = loadQaKb();
} catch (err) {
  if (err instanceof KbError) for (const i of err.issues) log.error(`kb invalid: ${i.where}: ${i.message}`);
  else log.error("could not load the knowledge base");
  process.exit(1);
}

const client = createDiscordClient();
const sessions = createSessionStore();
sessions.start();

const alert = createStaffAlerter({ send: createStaffLogSender(client, config.DISCORD_STAFF_LOG_CHANNEL_ID) });
const getGuild = () => client.guilds.fetch(config.DISCORD_GUILD_ID);

const app = buildApp({
  isDiscordReady: () => client.isReady(),
  revoke: {
    secret: config.DISCORD_BOT_OUTBOUND_SECRET,
    revoke: createRoleRevoker({ getGuild, roleId: config.DISCORD_REIBLAST_ROLE_ID }),
    forgetUser: (userId) => {
      sessions.clearPending(userId);
      sessions.clearVerified(userId);
    },
    alert,
  },
});

const serverClient = createServerClient({
  baseUrl: config.REIBLAST_SERVER_URL,
  secret: config.DISCORD_BOT_INBOUND_SECRET,
  vercelBypassSecret: config.VERCEL_PROTECTION_BYPASS_SECRET,
});
const flow = createVerifyFlow({
  serverClient,
  sessions,
  rules,
  supportPhone: config.SUPPORT_PHONE,
  grantRole: createRoleGranter({ getGuild, roleId: config.DISCORD_REIBLAST_ROLE_ID }),
  alert,
});
const setup = createSetupHandler({
  guildId: config.DISCORD_GUILD_ID,
  staffRoleId: config.DISCORD_STAFF_ROLE_ID,
  getVerifyChannel: async () => {
    const channel = await client.channels.fetch(config.DISCORD_VERIFY_CHANNEL_ID);
    return channel?.isSendable() ? channel : null;
  },
});
const unlink = createUnlinkHandler({
  guildId: config.DISCORD_GUILD_ID,
  staffRoleId: config.DISCORD_STAFF_ROLE_ID,
  serverClient,
  revoke: createRoleRevoker({ getGuild, roleId: config.DISCORD_REIBLAST_ROLE_ID }),
  forgetUser: (userId) => {
    sessions.clearPending(userId);
    sessions.clearVerified(userId);
  },
  alert,
});
const qa = createQa(client, config, kb, alert);
qa.registerListeners();
qa.checkSetupOnReady();
log.info("knowledge base loaded", { entries: kb.entries.length, hash: kb.hash });
registerInteractionHandlers(client, { flow, setup, unlink, qa: qa.buttons });


// HTTP first so the health check answers (503) while the gateway is still connecting.
const server = await startHttpServer(app, config.PORT);
log.info("http listening", { port: config.PORT });

try {
  await client.login(config.DISCORD_BOT_TOKEN);
} catch (err) {
  log.error("discord login failed", { message: err instanceof Error ? err.message : "unknown" });
  process.exit(1); // Railway ALWAYS-restart brings us back
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  const hardStop = setTimeout(() => {
    log.error("shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000);
  hardStop.unref();
  sessions.stop();
  await closeHttpServer(server);
  await client.destroy();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection", { message: reason instanceof Error ? reason.message : "non-error rejection" });
});
