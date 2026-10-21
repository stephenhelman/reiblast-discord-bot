/** One-off: registers the guild slash commands. Run with `npm run register-commands` (needs the same env as the bot). */
import { REST, Routes } from "discord.js";
import { loadConfig } from "../config.js";
import { setupVerifyCommand } from "./commands.js";

const config = loadConfig();
const rest = new REST().setToken(config.DISCORD_BOT_TOKEN);
const body = [setupVerifyCommand.toJSON()];

await rest.put(Routes.applicationGuildCommands(config.DISCORD_APPLICATION_ID, config.DISCORD_GUILD_ID), { body });
console.log(`registered ${body.length} command(s): ${body.map((c) => c.name).join(", ")}`);
