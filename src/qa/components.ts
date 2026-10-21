import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { QA_IDS } from "./ids.js";
import { QA_LABELS } from "./messages.js";

/** "That solved it" / "Still need help", under an answer posted in the forum. */
export function buildAnswerRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(QA_IDS.solved).setLabel(QA_LABELS.solved).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(QA_IDS.help).setLabel(QA_LABELS.help).setStyle(ButtonStyle.Secondary),
  );
}
