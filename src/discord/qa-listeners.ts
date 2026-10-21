import { Events, type Client } from "discord.js";
import { createLogger } from "../logger.js";
import type { QaHandler } from "../qa/handler.js";
import { loadStarter, toQaMessage, type QaIds } from "./qa-adapter.js";

/**
 * Gateway listeners for the Q&A feature: every new message, and forum posts whose tags change. Errors never escape a
 * listener; only an error name is logged.
 */
export function registerQaListeners(client: Client, deps: { ids: QaIds; handler: () => QaHandler }): void {
  const log = createLogger("qa-listeners");
  const guard = (what: string, run: () => Promise<void>) => {
    run().catch((err: unknown) => log.error("listener failed", { what, error: err instanceof Error ? err.name : "unknown" }));
  };

  client.on(Events.MessageCreate, (message) => {
    guard("message", async () => {
      const botId = client.user?.id;
      if (!botId) return;
      const qa = toQaMessage(message, deps.ids, botId);
      if (qa) await deps.handler().handleMessage(qa);
    });
  });

  client.on(Events.ThreadUpdate, (oldThread, newThread) => {
    guard("thread_update", async () => {
      const botId = client.user?.id;
      if (!botId || newThread.guildId !== deps.ids.guildId) return;
      await deps.handler().handleTagAdded({
        threadId: newThread.id,
        change: {
          inForum: newThread.parentId === deps.ids.forumId,
          oldTags: oldThread.appliedTags,
          newTags: newThread.appliedTags,
        },
        loadStarter: () => loadStarter(newThread, deps.ids, botId),
      });
    });
  });
}
