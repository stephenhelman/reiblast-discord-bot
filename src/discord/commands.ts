import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const SETUP_VERIFY = "setup-verify";

export const setupVerifyCommand = new SlashCommandBuilder()
  .setName(SETUP_VERIFY)
  .setDescription("Post the Verify panel in the Verify channel (staff only)")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

export const UNLINK = "unlink";

export const unlinkCommand = new SlashCommandBuilder()
  .setName(UNLINK)
  .setDescription("Unlink a member's REIblast account and remove their role (staff only)")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName("user").setDescription("The Discord member to unlink").setRequired(true));
