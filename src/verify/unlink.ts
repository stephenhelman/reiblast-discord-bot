import { MessageFlags } from "discord.js";
import { createLogger, type Logger } from "../logger.js";
import type { RevokeResult } from "../roles/revoke.js";
import type { ServerClient } from "../server-client/types.js";
import { hasRole, type SetupInteractionLike } from "./setup.js";

export interface UnlinkInteractionLike extends SetupInteractionLike {
  options: { getUser(name: "user", required: true): { id: string } };
}

const TRY_AGAIN = "Something went wrong talking to the REIblast server. Please try again in a few minutes.";

/**
 * /unlink @user (staff). Asks the server to clear the link, then removes the role itself (the server queues no
 * revoke) and drops any in-memory verify state. Logs reason codes only — never the target's Discord ID.
 */
export function createUnlinkHandler(opts: {
  guildId: string;
  staffRoleId: string;
  serverClient: Pick<ServerClient, "unlink">;
  revoke: (userId: string) => Promise<RevokeResult>;
  forgetUser: (userId: string) => void;
  alert?: (code: string) => void;
  logger?: Logger;
}) {
  const log = opts.logger ?? createLogger("unlink");
  const EPH = MessageFlags.Ephemeral;

  return async (i: UnlinkInteractionLike): Promise<void> => {
    try {
      if (i.guildId !== opts.guildId || !hasRole(i.member, opts.staffRoleId)) {
        log.warn("unlink denied");
        await i.reply({ content: "Only REIblast staff can use this command.", flags: EPH });
        return;
      }
      await i.deferReply({ flags: EPH });
      const targetId = i.options.getUser("user", true).id;

      const outcome = await opts.serverClient.unlink(targetId);
      if (outcome.result === "error") {
        log.warn("unlink server error", { reason: outcome.reason });
        opts.alert?.(outcome.reason);
        await i.editReply({ content: TRY_AGAIN });
        return;
      }

      // Linked or not, the Discord side must end up clean: no pending/verified session, no role.
      opts.forgetUser(targetId);
      const removal = await opts.revoke(targetId);
      log.info("unlink", { reason: outcome.reason, role: removal.status === "failed" ? removal.reason : removal.status });

      if (removal.status === "failed") {
        opts.alert?.(`unlink_role_${removal.reason}`);
        await i.editReply({
          content: "The link was cleared, but I couldn't remove their role. Please remove it manually. I've alerted staff.",
        });
        return;
      }
      const roleNote =
        removal.status === "revoked"
          ? "role removed"
          : removal.status === "not_holding_role"
            ? "they didn't hold the role"
            : "they're not in the server";
      const content =
        outcome.reason === "unlinked"
          ? `Unlinked and ${roleNote} — they can verify again with a new account.`
          : `They weren't linked; ${roleNote}. Any in-progress verification was cleared.`;
      await i.editReply({ content });
    } catch (err) {
      log.error("unlink failed", { error: err instanceof Error ? err.name : "unknown" });
      try {
        await i.editReply({ content: TRY_AGAIN });
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
