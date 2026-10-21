import { discordCode } from "./errors.js";

export type GrantFailure = "member_not_found" | "missing_permissions" | "role_not_found" | "discord_unavailable";

export type GrantResult =
  | { status: "granted" }
  | { status: "already_had" }
  | { status: "failed"; reason: GrantFailure };

export interface MemberLike {
  roles: { cache: { has(id: string): boolean }; add(id: string, reason?: string): Promise<unknown> };
}
export interface GuildLike {
  members: { fetch(userId: string): Promise<MemberLike> };
}

function classify(err: unknown): GrantFailure {
  switch (discordCode(err)) {
    case 10007: // Unknown Member
    case 10013: // Unknown User
      return "member_not_found";
    case 10011: // Unknown Role
      return "role_not_found";
    case 50013: // Missing Permissions (also: bot role below the target role)
    case 50001: // Missing Access
      return "missing_permissions";
    default:
      return "discord_unavailable";
  }
}

/** Grants the REIblast role. No-op if the member already holds it. Never throws: failures come back as a result. */
export function createRoleGranter(opts: { getGuild: () => Promise<GuildLike>; roleId: string }) {
  return async (userId: string): Promise<GrantResult> => {
    try {
      const guild = await opts.getGuild();
      const member = await guild.members.fetch(userId);
      if (member.roles.cache.has(opts.roleId)) return { status: "already_had" };
      await member.roles.add(opts.roleId, "REIblast verification");
      return { status: "granted" };
    } catch (err) {
      return { status: "failed", reason: classify(err) };
    }
  };
}
