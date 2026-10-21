import type { Client } from "discord.js";
import { createLogger, type Logger } from "../logger.js";

const DEDUP_MS = 30 * 60 * 1000;

/** Static hints keyed by reason code, so the alert says what to check without carrying any user data. */
const HINTS: Record<string, string> = {
  auth_missing: "The bot's secret header is not reaching the server. Check DISCORD_BOT_INBOUND_SECRET.",
  auth_failed: "The server rejected the bot's secret. DISCORD_BOT_INBOUND_SECRET differs between bot and server.",
  server_misconfigured: "The server has no DISCORD_BOT_INBOUND_SECRET set.",
  bad_json: "The server could not parse a request from the bot (bug).",
  bad_request: "The server rejected a request the bot built (bug).",
  role_missing_permissions: "Role grant was refused. Check Manage Roles and that the bot's role is above the REIblast role.",
  role_not_found: "The REIblast role ID in config does not exist in the server.",
  role_member_not_found: "A member finished verifying but could not be found in the server (they may have left).",
  revoke_missing_permissions:
    "A revoke could not remove the role. Check Manage Roles and that the bot's role is above the REIblast role. Server will retry.",
  unlink_role_missing_permissions:
    "A staff /unlink cleared the link but the role could not be removed. Check Manage Roles and that the bot's role is above the REIblast role; remove the role by hand.",
  unlink_role_discord_unavailable:
    "A staff /unlink cleared the link but the role removal failed on a Discord error. Remove the role by hand.",
  role_discord_unavailable: "Role grant failed on a Discord error or the gateway was not ready.",
  qa_misconfigured: "Support Q&A setup check found a problem (a tag ID not in the forum, a missing permission, or a support role that isn't mentionable). See the bot log for the codes and SETUP.md.",
  qa_api_error: "The AI answer request failed (API error). Affected posts were handed to staff.",
  qa_timeout: "The AI answer request timed out. Affected posts were handed to staff.",
  qa_refusal: "The AI model declined to answer. Affected posts were handed to staff.",
  qa_max_tokens: "The AI answer was cut off. Affected posts were handed to staff.",
  qa_bad_output: "The AI returned an unusable answer. Affected posts were handed to staff.",
  qa_post_failed: "The bot could not post an answer. Check View Channel, Send Messages in Posts, and Read Message History in the support forum.",
  qa_button_failed: "A Q&A button click failed unexpectedly. Check the bot's permissions in the support forum.",
  qa_tag_swap_failed: "The bot could not change a post's tags. Check Manage Threads in the support forum; change the tag by hand.",
  qa_escalation_failed: "An escalation did not complete. Check the support role, Support channel permissions, and Manage Threads; handle the post by hand.",
};

/**
 * Posts reason-code-only alerts to the staff log channel, at most once per code per 30 minutes. Never throws and
 * never blocks the caller.
 */
export function createStaffAlerter(opts: {
  send: (text: string) => Promise<void>;
  dedupMs?: number;
  now?: () => number;
  logger?: Logger;
}): (code: string) => void {
  const dedup = opts.dedupMs ?? DEDUP_MS;
  const now = opts.now ?? Date.now;
  const log = opts.logger ?? createLogger("alert");
  const lastSent = new Map<string, number>();

  return (code) => {
    const t = now();
    const prev = lastSent.get(code);
    if (prev !== undefined && t - prev < dedup) return;
    lastSent.set(code, t);
    const hint = HINTS[code];
    const area = code.startsWith("qa_") ? "Support Q&A" : "Verify flow";
    const text = `⚠️ ${area} needs attention: \`${code}\`${hint ? ` — ${hint}` : ""}`;
    Promise.resolve()
      .then(() => opts.send(text))
      .then(() => log.warn("staff alert sent", { code }))
      .catch((err: unknown) => log.error("staff alert failed", { code, error: err instanceof Error ? err.name : "unknown" }));
  };
}

export function createStaffLogSender(client: Client, channelId: string): (text: string) => Promise<void> {
  return async (text) => {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable()) throw new Error("staff log channel is not sendable");
    await channel.send({ content: text, allowedMentions: { parse: [] } });
  };
}
