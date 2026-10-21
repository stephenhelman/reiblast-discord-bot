import { loadConfig } from "./config.js";
import { createDiscordClient } from "./discord/client.js";
import { buildApp, closeHttpServer, startHttpServer } from "./http/server.js";
import { createLogger } from "./logger.js";

const config = loadConfig();
process.env.LOG_LEVEL = config.LOG_LEVEL;
const log = createLogger("boot");

const client = createDiscordClient();
const app = buildApp({ isDiscordReady: () => client.isReady() });

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
