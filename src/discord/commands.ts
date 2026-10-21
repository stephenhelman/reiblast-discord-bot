import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const SETUP_VERIFY = "setup-verify";

export const setupVerifyCommand = new SlashCommandBuilder()
  .setName(SETUP_VERIFY)
  .setDescription("Post the Verify panel in the Verify channel (staff only)")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);
