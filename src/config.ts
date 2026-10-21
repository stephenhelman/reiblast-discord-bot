/**
 * Env validation — fail fast at boot. On failure only variable NAMES and a generic problem are printed,
 * never values (zod's default messages can echo input).
 */
import { z } from "zod";

const snowflake = z.string().regex(/^\d{15,25}$/, "must be a Discord ID (15-25 digits)");
const nonEmpty = z.string().trim().min(1, "is required");

const schema = z
  .object({
    DISCORD_BOT_TOKEN: nonEmpty,
    DISCORD_APPLICATION_ID: snowflake,
    DISCORD_GUILD_ID: snowflake,
    DISCORD_REIBLAST_ROLE_ID: snowflake,
    DISCORD_VERIFY_CHANNEL_ID: snowflake,
    DISCORD_STAFF_ROLE_ID: snowflake,
    DISCORD_STAFF_LOG_CHANNEL_ID: snowflake,
    REIBLAST_SERVER_URL: z
      .string()
      .url("must be a URL")
      .refine((u) => /^https?:\/\//.test(u), "must be http(s)")
      .transform((u) => u.replace(/\/+$/, "")),
    DISCORD_BOT_INBOUND_SECRET: nonEmpty,
    DISCORD_BOT_OUTBOUND_SECRET: nonEmpty,
    // Optional: only for Vercel preview deployments behind Deployment Protection. Leave unset in production.
    VERCEL_PROTECTION_BYPASS_SECRET: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined)),
    SUPPORT_PHONE: nonEmpty,
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .refine((e) => e.DISCORD_BOT_INBOUND_SECRET !== e.DISCORD_BOT_OUTBOUND_SECRET, {
    path: ["DISCORD_BOT_OUTBOUND_SECRET"],
    message: "must differ from DISCORD_BOT_INBOUND_SECRET",
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues.map((i) => {
    const name = i.path.join(".") || "(env)";
    const what = i.code === "invalid_type" && i.received === "undefined" ? "is required" : i.message;
    return `  - ${name}: ${what}`;
  });
  console.error(`[config] invalid environment:\n${problems.join("\n")}`);
  process.exit(1);
}
