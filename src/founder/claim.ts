import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { createLogger, type Logger } from "../logger.js";
import type { ServerClient } from "../server-client/types.js";

/** Static custom ID, handled in the interaction router (not a collector) so it survives restarts. */
export const FOUNDER_CLAIM_ID = "founder_claim";

const GENERIC_ERROR = "Something went wrong. Try again in a minute or text support.";
const RATE_LIMITED = "You're pressing too fast. Wait a minute and try again.";

export function buildFounderPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🏆 Founder's Offer: Claim Your REIsite Slot")
    .setColor(16107586)
    .setDescription(
      "The first member to claim gets REIsite + REIkit completely free. The next 9 get REIsite for $100 (normally $500), with REIkit free. Claims open Wednesday, Oct 28 at 7 PM CT and close Oct 31 at 11:59 PM CT. Press the button to get your personal claim link.",
    )
    .setFooter({ text: "REIsite & REIkit provided by OP Web Studio, a subsidiary of Operation Profit LLC" });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(FOUNDER_CLAIM_ID).setLabel("Claim my spot").setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

export function createFounderHandlers(opts: { serverClient: Pick<ServerClient, "founderLink">; logger?: Logger }) {
  const log = opts.logger ?? createLogger("founder");
  const EPH = MessageFlags.Ephemeral;

  /** /post-founder-claim: administrators only; posts the panel in the current channel. */
  async function post(i: ChatInputCommandInteraction): Promise<void> {
    try {
      if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await i.reply({ content: "Only administrators can use this command.", flags: EPH });
        return;
      }
      const channel = i.channel;
      if (!channel?.isSendable()) {
        await i.reply({ content: "I can't post in this channel. Check my permissions.", flags: EPH });
        return;
      }
      await i.deferReply({ flags: EPH });
      await channel.send(buildFounderPanel());
      log.info("founder claim panel posted");
      await i.editReply({ content: "Founder claim panel posted." });
    } catch (err) {
      log.error("post-founder-claim failed", { error: err instanceof Error ? err.name : "unknown" });
      try {
        if (i.deferred) await i.editReply({ content: "I couldn't post the panel. Check that I can send messages here." });
        else await i.reply({ content: "I couldn't post the panel.", flags: EPH });
      } catch {
        /* interaction expired */
      }
    }
  }

  /** The "Claim my spot" button. Ephemeral throughout; never logs the URL, token or secret. */
  async function claim(i: ButtonInteraction): Promise<void> {
    try {
      await i.deferReply({ flags: EPH });
    } catch {
      return; // interaction expired or already acknowledged
    }
    let content = GENERIC_ERROR;
    let components: ActionRowBuilder<ButtonBuilder>[] = [];
    try {
      const outcome = await opts.serverClient.founderLink(i.user.id);
      if (outcome.result === "ok") {
        content = outcome.message;
        components = [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open your claim page").setURL(outcome.url),
          ),
        ];
      } else if (outcome.result === "not_verified") {
        content = outcome.message;
      } else if (outcome.result === "refused") {
        content = RATE_LIMITED;
      } else {
        log.warn("founder-link error", { reason: outcome.reason });
      }
      if (outcome.result !== "error") log.info("founder-link result", { result: outcome.result, reason: outcome.reason });
    } catch (err) {
      log.error("founder claim failed", { error: err instanceof Error ? err.name : "unknown" });
    }
    try {
      await i.editReply({ content, components });
    } catch (err) {
      log.error("founder claim reply failed", { error: err instanceof Error ? err.name : "unknown" });
    }
  }

  return { post, claim };
}
