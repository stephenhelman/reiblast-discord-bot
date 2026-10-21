import { MessageFlags } from "discord.js";
import { createLogger, type Logger } from "../logger.js";
import { buildPanelMessage } from "./components.js";

export interface SetupInteractionLike {
  guildId: string | null;
  member: { roles: string[] | { cache: { has(id: string): boolean } } } | null;
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
}

export interface PanelChannel {
  send(options: ReturnType<typeof buildPanelMessage>): Promise<unknown>;
}

export function hasRole(member: SetupInteractionLike["member"], roleId: string): boolean {
  if (!member) return false;
  return Array.isArray(member.roles) ? member.roles.includes(roleId) : member.roles.cache.has(roleId);
}

/**
 * /setup-verify. Discord already hides it from members without Manage Server; this re-checks the staff role at
 * runtime (permissions can be overridden per server) and only posts to the configured Verify channel.
 */
export function createSetupHandler(opts: {
  guildId: string;
  staffRoleId: string;
  getVerifyChannel: () => Promise<PanelChannel | null>;
  logger?: Logger;
}) {
  const log = opts.logger ?? createLogger("setup");
  const EPH = MessageFlags.Ephemeral;

  return async (i: SetupInteractionLike): Promise<void> => {
    try {
      if (i.guildId !== opts.guildId || !hasRole(i.member, opts.staffRoleId)) {
        log.warn("setup-verify denied");
        await i.reply({ content: "Only REIblast staff can use this command.", flags: EPH });
        return;
      }
      await i.deferReply({ flags: EPH });
      const channel = await opts.getVerifyChannel();
      if (!channel) {
        await i.editReply({ content: "I couldn't find the Verify channel. Check DISCORD_VERIFY_CHANNEL_ID and my permissions." });
        return;
      }
      await channel.send(buildPanelMessage());
      log.info("verify panel posted");
      await i.editReply({ content: "Verify panel posted." });
    } catch (err) {
      log.error("setup-verify failed", { error: err instanceof Error ? err.name : "unknown" });
      try {
        await i.editReply({ content: "I couldn't post the panel. Check that I can send messages in the Verify channel." });
      } catch {
        try {
          await i.reply({ content: "Something went wrong.", flags: EPH });
        } catch {
          /* interaction expired */
        }
      }
    }
  };
}
