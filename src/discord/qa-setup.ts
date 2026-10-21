import { ChannelType, type Client, type ThreadChannel } from "discord.js";
import type { Config } from "../config.js";
import { loadKb, type Kb } from "../kb/load.js";
import { createLogger } from "../logger.js";
import { createAnswerer, createAnthropicClient } from "../qa/answer.js";
import { createIntake, createSummarizer } from "../qa/intake.js";
import { createAnswerButtonHandler } from "../qa/buttons.js";
import { createEscalator } from "../qa/escalate.js";
import { createQaHandler, type QaHandler } from "../qa/handler.js";
import { createCoalescer, createRateLimiter } from "../qa/limits.js";
import { createPrivateThreadCreator } from "../qa/private-thread.js";
import { createThreadStateStore } from "../qa/state.js";
import { createStaffButtonHandler } from "../qa/staff-buttons.js";
import { createStaffLog } from "../qa/stafflog.js";
import { createRefReader } from "../qa/threadref.js";
import type { TriggerConfig } from "../qa/triggers.js";
import { createStaffLogSender } from "./staff-alert.js";
import { checkQaSetup, createFetchOldest, fetchThreadMessages, toAnswerButton, toStaffButton, type QaIds } from "./qa-adapter.js";
import { registerQaListeners } from "./qa-listeners.js";
import type { ButtonInteraction } from "discord.js";

/** Reads and validates the knowledge base at boot. Throws KbError (file:line problems only) if it is invalid. */
export function loadQaKb(): Kb {
  return loadKb();
}

export interface Qa {
  /** Button routing for interactions.ts: each returns true if the interaction was one of its buttons. */
  buttons: {
    answer: (i: ButtonInteraction) => Promise<boolean>;
    staff: (i: ButtonInteraction) => Promise<boolean>;
  };
  /** Subscribes to MessageCreate and ThreadUpdate. */
  registerListeners(): void;
  /** Once the gateway is ready: checks IDs and permissions and alerts staff (codes only) if something is off. */
  checkSetupOnReady(): void;
}

/**
 * Builds the whole Q&A graph. The bot's own user ID is only known after login, so the graph is built on first use
 * (events and interactions only arrive after the gateway is ready).
 */
export function createQa(client: Client, config: Config, kb: Kb, alert: (code: string) => void): Qa {
  const log = createLogger("qa-setup");
  const tags: TriggerConfig = {
    tagSupportId: config.DISCORD_TAG_SUPPORT_ID,
    tagResolvedId: config.DISCORD_TAG_RESOLVED_ID,
    tagNeedsStaffId: config.DISCORD_TAG_NEEDS_STAFF_ID,
  };
  const ids: QaIds = {
    guildId: config.DISCORD_GUILD_ID,
    forumId: config.DISCORD_SUPPORT_FORUM_ID,
    supportChannelId: config.DISCORD_SUPPORT_CHANNEL_ID,
    staffRoleId: config.DISCORD_STAFF_ROLE_ID,
    supportRoleId: config.DISCORD_SUPPORT_ROLE_ID,
    tags,
  };

  const build = (botId: string) => {
    const refs = createRefReader({ botId, fetchOldest: createFetchOldest(client) });
    const staffLog = createStaffLog({ write: createStaffLogSender(client, config.DISCORD_STAFF_LOG_CHANNEL_ID) });
    const createPrivateThread = createPrivateThreadCreator({
      supportRoleId: config.DISCORD_SUPPORT_ROLE_ID,
      refs,
      getParent: async () => {
        const channel = await client.channels.fetch(config.DISCORD_SUPPORT_CHANNEL_ID);
        if (!channel || channel.type !== ChannelType.GuildText) return null;
        return { threads: { create: (o) => channel.threads.create(o) } };
      },
    });
    const escalator = createEscalator({ tags, supportRoleId: config.DISCORD_SUPPORT_ROLE_ID, createPrivateThread, staffLog, alert });
    const state = createThreadStateStore();
    const answer = createAnswerer({ client: createAnthropicClient(config.ANTHROPIC_API_KEY), kb });
    const intake = createIntake({
      state,
      summarize: createSummarizer(answer),
      botId,
      // The button adapter hands us the real thread channel; ThreadLike is just the slice the handlers use.
      fetchMessages: (thread) => fetchThreadMessages(thread as unknown as ThreadChannel),
    });
    const handler = createQaHandler({
      botId,
      tags,
      answer,
      limiter: createRateLimiter(),
      state,
      intake,
      coalesce: createCoalescer((err) => log.error("answer run failed", { error: err instanceof Error ? err.name : "unknown" })),
      escalator,
      alert,
    });
    const answerButtons = createAnswerButtonHandler({
      tags,
      staffRoleId: config.DISCORD_STAFF_ROLE_ID,
      escalate: async ({ thread }) => escalator.handoff(thread, "help_button", await intake.contextFor(thread)),
      alert,
    });
    const staffButtons = createStaffButtonHandler({
      staffRoleId: config.DISCORD_STAFF_ROLE_ID,
      supportRoleId: config.DISCORD_SUPPORT_ROLE_ID,
      botId,
      needsStaffTagId: tags.tagNeedsStaffId,
      escalator,
      resolveMember: async (userId) => {
        const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID);
        const member = await guild.members.fetch(userId).catch(() => null);
        return member ? { id: member.id, displayName: member.displayName } : null;
      },
      staffLog,
      alert,
    });
    return { handler, answerButtons, staffButtons };
  };

  let graph: ReturnType<typeof build> | undefined;
  const get = () => {
    if (!graph) {
      const botId = client.user?.id;
      if (!botId) throw new Error("gateway not ready");
      graph = build(botId);
    }
    return graph;
  };

  return {
    buttons: {
      answer: async (i) => get().answerButtons(toAnswerButton(i)),
      staff: async (i) => get().staffButtons(toStaffButton(i)),
    },
    registerListeners: () => registerQaListeners(client, { ids, handler: (): QaHandler => get().handler }),
    checkSetupOnReady() {
      client.once("clientReady", () => {
        checkQaSetup(client, ids)
          .then((problems) => {
            if (problems.length === 0) return log.info("setup check passed", { kb_entries: kb.entries.length, kb_hash: kb.hash });
            log.error("setup check found problems", { problems: problems.join(",") });
            alert("qa_misconfigured");
          })
          .catch((err: unknown) => log.error("setup check failed", { error: err instanceof Error ? err.name : "unknown" }));
      });
    },
  };
}
