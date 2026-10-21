/** The numeric Discord API error code on a thrown error (discord.js DiscordAPIError#code), if any. */
export function discordCode(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code: unknown }).code;
    return typeof c === "number" ? c : undefined;
  }
  return undefined;
}
