import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { IDS } from "./ids.js";
import { RULES_TITLE } from "./rules.js";

export type IdentifierKind = "email" | "locationId";

export function buildPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle("Verify your REIblast account")
    .setDescription(
      [
        "Verify to unlock the REIblast community channels.",
        "",
        "**With email** — use the email you signed up with (the one from your REIblast purchase).",
        "**With location ID** — if your email doesn't work, use your sub-account's location ID. " +
          "You'll find it in your sub-account settings, or in the URL after `/location/`.",
        "",
        "We'll text a 6-digit code to the phone number on your account.",
      ].join("\n"),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(IDS.buttonEmail).setLabel("Verify with email").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(IDS.buttonLocation).setLabel("Verify with location ID").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

function textInputRow(input: TextInputBuilder) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

export function buildIdentifierModal(kind: IdentifierKind): ModalBuilder {
  const input = new TextInputBuilder().setCustomId(IDS.fieldIdentifier).setStyle(TextInputStyle.Short).setRequired(true);
  if (kind === "email") {
    input.setLabel("Email you signed up with").setPlaceholder("you@example.com").setMaxLength(254);
    return new ModalBuilder().setCustomId(IDS.modalEmail).setTitle("Verify with email").addComponents(textInputRow(input));
  }
  input
    .setLabel("Location ID")
    .setPlaceholder("Sub-account settings, or the URL after /location/")
    .setMaxLength(64);
  return new ModalBuilder().setCustomId(IDS.modalLocation).setTitle("Verify with location ID").addComponents(textInputRow(input));
}

export function buildCodeModal(): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(IDS.fieldCode)
    .setLabel("6-digit code")
    .setPlaceholder("123456")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(6);
  return new ModalBuilder().setCustomId(IDS.modalCode).setTitle("Enter your code").addComponents(textInputRow(input));
}

export function buildEnterCodeRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(IDS.buttonEnterCode).setLabel("Enter Code").setStyle(ButtonStyle.Primary),
  );
}

export function buildAgreeRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(IDS.buttonAgree).setLabel("I agree").setStyle(ButtonStyle.Success),
  );
}

/** Rules as embeds; the title goes on the first one only. */
export function buildRulesEmbeds(chunks: string[]): EmbedBuilder[] {
  return chunks.map((text, i) => {
    const e = new EmbedBuilder().setDescription(text);
    if (i === 0) e.setTitle(RULES_TITLE);
    return e;
  });
}
