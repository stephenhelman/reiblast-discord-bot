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

/** Under each guided-troubleshooting question: only "Still need help", so a stuck member can bail out to staff at any step. */
export function buildHelpOnlyRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(QA_IDS.help).setLabel(QA_LABELS.help).setStyle(ButtonStyle.Secondary),
  );
}

/** Staff-only, under the "handing this to the team" message in a Needs Staff post. */
export function buildMovePrivateRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(QA_IDS.toPrivate).setLabel(QA_LABELS.movePrivate).setStyle(ButtonStyle.Primary),
  );
}

/** Staff-only, on the first message of a private thread. */
export function buildCloseRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(QA_IDS.close).setLabel(QA_LABELS.close).setStyle(ButtonStyle.Danger),
  );
}
