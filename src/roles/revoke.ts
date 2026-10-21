import { discordCode } from "./errors.js";

export type RevokeResult =
  | { status: "revoked" }
  | { status: "not_holding_role" }
  | { status: "not_in_guild" }
  | { status: "failed"; reason: "missing_permissions" | "discord_unavailable" };

export interface RevokableMember {
  roles: { cache: { has(id: string): boolean }; remove(id: string, reason?: string): Promise<unknown> };
}
export interface RevokeGuildLike {
  members: { fetch(options: { user: string; force: boolean }): Promise<RevokableMember> };
}

/**
 * Removes the REIblast role. Idempotent: a member who left the server (Unknown Member) or doesn't hold the role is a
 * successful no-op. Never throws — failures come back as a result.
 */
export function createRoleRevoker(opts: { getGuild: () => Promise<RevokeGuildLike>; roleId: string }) {
  return async (userId: string): Promise<RevokeResult> => {
    try {
      const guild = await opts.getGuild();
      // force: a stale cached member must not make us skip a removal.
      const member = await guild.members.fetch({ user: userId, force: true });
      if (!member.roles.cache.has(opts.roleId)) return { status: "not_holding_role" };
      await member.roles.remove(opts.roleId, "REIblast access revoked");
      return { status: "revoked" };
    } catch (err) {
      switch (discordCode(err)) {
        case 10007: // Unknown Member
        case 10013: // Unknown User
          return { status: "not_in_guild" };
        case 50013: // Missing Permissions (also: bot role below the REIblast role)
        case 50001: // Missing Access
          return { status: "failed", reason: "missing_permissions" };
        default:
          return { status: "failed", reason: "discord_unavailable" };
      }
    }
  };
}
