import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PermissionFlagsBits as P, PermissionsBitField } from "discord.js";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const setup = readFileSync(join(root, "SETUP.md"), "utf8");
const envExample = readFileSync(join(root, ".env.example"), "utf8");

// The permissions the bot needs, by what each is for. SETUP.md's invite URL must carry exactly this set.
const NEEDED = [
  P.ManageRoles, // grant / remove the REIblast role
  P.ViewChannel,
  P.SendMessages,
  P.EmbedLinks,
  P.ReadMessageHistory,
  P.ManageThreads, // change a post's tags; archive + lock private threads
  P.CreatePrivateThreads,
  P.SendMessagesInThreads,
];

describe("SETUP.md", () => {
  it("invite URL carries exactly the permissions the bot needs", () => {
    const m = /permissions=(\d+)/.exec(setup);
    expect(m).not.toBeNull();
    expect(BigInt(m![1]!)).toBe(new PermissionsBitField(NEEDED).bitfield);
  });

  it("explains the integer in the text", () => {
    const m = /permissions=(\d+)/.exec(setup)!;
    expect(setup).toContain(`\`${m[1]}\` =`);
    for (const phrase of ["Manage Threads", "Create Private Threads", "Send Messages in Threads", "Read Message History"]) {
      expect(setup).toContain(phrase);
    }
  });

  it("does not ask for Mention Everyone; the support role must be mentionable instead", () => {
    const bits = BigInt(/permissions=(\d+)/.exec(setup)![1]!);
    expect(bits & P.MentionEveryone).toBe(0n);
    expect(setup).not.toMatch(/\*\*Mention Everyone\*\*/);
    expect(setup).toMatch(/Allow anyone to @mention this role/);
    expect(setup).toContain("support_role_not_mentionable");
  });

  it("says the Message Content intent is ON", () => {
    expect(setup).toMatch(/Message Content Intent: ON/);
    expect(setup).not.toMatch(/Message Content Intent: OFF/);
  });

  it("lists the seven new variables in the Railway step and the local .env list", () => {
    const names = [
      "DISCORD_SUPPORT_FORUM_ID",
      "DISCORD_TAG_SUPPORT_ID",
      "DISCORD_TAG_RESOLVED_ID",
      "DISCORD_TAG_NEEDS_STAFF_ID",
      "DISCORD_SUPPORT_CHANNEL_ID",
      "DISCORD_SUPPORT_ROLE_ID",
      "ANTHROPIC_API_KEY",
    ];
    const railway = setup.slice(setup.indexOf("## 6. Railway"), setup.indexOf("## 7."));
    for (const n of names) {
      expect(railway, `Railway step lists ${n}`).toContain(n);
      expect(envExample, `.env.example lists ${n}`).toContain(`${n}=`);
    }
    expect(railway).toMatch(/BEFORE pushing/);
  });

  it("documents guided troubleshooting, its log codes, and what to maintain", () => {
    for (const phrase of [
      "Guided troubleshooting",
      "Check N of 4",
      "Quick question",
      "Still need help",
      "Case summary for the team:",
      "a2p-041",
      "snd-042",
      "wal-014",
      "summary_unavailable",
      "button_clear_failed",
      "intake_ask_failed",
    ]) {
      expect(setup, phrase).toContain(phrase);
    }
    expect(setup).toMatch(/kb ok: 255 entries/);
  });

  it("documents the helper commands it points to", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const script of ["list-forum-tags", "verify-private-threads", "eval:qa", "kb:check"]) {
      expect(pkg.scripts[script], `${script} exists`).toBeDefined();
      expect(setup).toContain(script);
    }
  });
});

describe("docs/qa-live-test.md", () => {
  const doc = readFileSync(join(root, "docs", "qa-live-test.md"), "utf8");
  it("covers every required path", () => {
    for (const phrase of [
      "That solved it",
      "Still need help",
      "Needs Staff",
      "Not covered",
      "Account-specific",
      "Move to private",
      "Close",
      "Support tag added later",
      "@mention in a Tips post",
      "@mention in Chat",
      "Other members and staff are ignored",
      "rate limit",
      "follow-up from the poster",
      "Redeploy mid-thread",
      "@everyone",
      // guided troubleshooting
      "A full walk-through",
      "Check 1 of 4",
      "Quick question",
      "Help-only button and stale-button cleanup",
      "4-question cap",
      "mid-walk-through",
      "Case summary for the team:",
      "intake ask",
      "account_specific from a walk-through",
      "Yellow banner is answered directly",
      "Redeploy mid-walk-through",
      "summary_unavailable",
    ]) {
      expect(doc.toLowerCase(), phrase).toContain(phrase.toLowerCase());
    }
  });
});
