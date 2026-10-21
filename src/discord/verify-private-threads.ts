/**
 * Manual check of the Discord behaviors the private-thread design relies on. Run with `npm run verify-private-threads`
 * against a TEST server only. It creates ONE private thread under DISCORD_SUPPORT_CHANNEL_ID, adds the server owner,
 * posts one message, archives + locks it, then deletes it. Nothing is printed except pass/fail lines and message type names.
 *
 * Checks: ownerId; creator auto-added; whether a system message precedes ours; after=0 semantics; whether anything
 * appears top-level in the parent; ownerId + messages after archive/lock via a fresh REST read; whether a freshly
 * connected gateway session (a stand-in for a restart) already has the thread and receives its messages.
 */
import { ChannelType, Client, GatewayIntentBits, MessageType, type Message, type ThreadChannel } from "discord.js";
import { z } from "zod";

const env = z
  .object({
    DISCORD_BOT_TOKEN: z.string().trim().min(1),
    DISCORD_GUILD_ID: z.string().regex(/^\d{15,25}$/),
    DISCORD_SUPPORT_CHANNEL_ID: z.string().regex(/^\d{15,25}$/),
  })
  .safeParse(process.env);
if (!env.success) {
  console.error(`Set these in .env first: ${[...new Set(env.error.issues.map((i) => i.path.join(".")))].join(", ")}`);
  process.exit(1);
}
const cfg = env.data;

const results: Array<{ name: string; status: "PASS" | "FAIL" | "INFO"; detail: string }> = [];
const record = (name: string, status: "PASS" | "FAIL" | "INFO", detail = "") => {
  results.push({ name, status, detail });
  console.log(`${status.padEnd(4)}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const msgType = (m: Message) => `${MessageType[m.type] ?? m.type}${m.author.bot ? "(bot)" : ""}`;
const byId = (a: Message, b: Message) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
const errName = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : "unknown error");

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
let thread: ThreadChannel | undefined;
let fresh: Client | undefined;

try {
  await client.login(cfg.DISCORD_BOT_TOKEN);
  await new Promise<void>((r) => (client.isReady() ? r() : client.once("clientReady", () => r())));

  const guild = await client.guilds.fetch(cfg.DISCORD_GUILD_ID);
  const parent = await client.channels.fetch(cfg.DISCORD_SUPPORT_CHANNEL_ID);
  if (!parent || parent.type !== ChannelType.GuildText || parent.guildId !== guild.id) {
    throw new Error("DISCORD_SUPPORT_CHANNEL_ID is not a text channel in DISCORD_GUILD_ID.");
  }
  const ownerId = guild.ownerId;
  const botId = client.user!.id;

  // Baseline of the parent channel's latest top-level message
  let baseline: string | undefined;
  let canReadParent = true;
  try {
    baseline = (await parent.messages.fetch({ limit: 1 })).first()?.id;
  } catch (e) {
    canReadParent = false;
    record("read parent channel history", "INFO", `cannot read (${errName(e)}); top-level check skipped`);
  }

  // 1. create
  thread = await parent.threads.create({
    name: "verify-private-threads (temporary)",
    type: ChannelType.PrivateThread,
    invitable: false,
    autoArchiveDuration: 60,
    reason: "verify-private-threads",
  });
  record("create private thread (invitable:false)", "PASS");
  record("thread.ownerId === bot user", thread.ownerId === botId ? "PASS" : "FAIL");

  // 2. creator auto-added?
  try {
    const members = await thread.members.fetch();
    record("creator is auto-added as a thread member", members.has(botId) ? "PASS" : "FAIL");
  } catch (e) {
    record("creator is auto-added as a thread member", "INFO", `could not list members (${errName(e)})`);
  }

  // 3. add the member, then post our first message (pings the member only)
  await thread.members.add(ownerId);
  record("bot can add a member while invitable:false", "PASS");
  await thread.send({
    content: `<@${ownerId}> verification message — this thread will be deleted.\n-# ref staff_handoff post:0 member:${ownerId}`,
    allowedMentions: { parse: [], users: [ownerId] },
  });
  record("bot can post the first message with a user-only ping", "PASS");

  // 4. message order + after=0
  await new Promise((r) => setTimeout(r, 1500));
  const all = [...(await thread.messages.fetch({ limit: 100 })).values()].sort(byId);
  record("message order in thread (oldest first)", "INFO", all.map(msgType).join(" -> ") || "(none)");
  const sysBeforeOurs = all.findIndex((m) => m.author.id === botId && !m.system) > 0;
  record("a system message precedes our first message", "INFO", sysBeforeOurs ? "YES (so scan for the ref line, don't take the oldest)" : "no");

  const first1 = [...(await thread.messages.fetch({ after: "0", limit: 1 })).values()];
  record("after=0&limit=1 returns the oldest message", first1[0]?.id === all[0]?.id ? "PASS" : "FAIL", first1[0] ? msgType(first1[0]) : "none");
  const first20 = [...(await thread.messages.fetch({ after: "0", limit: 20 })).values()].sort(byId);
  record(
    "after=0&limit=20 returns the oldest messages (ours is among them)",
    first20.some((m) => m.author.id === botId && m.content.includes("-# ref staff_handoff")) ? "PASS" : "FAIL",
    first20.map(msgType).join(" -> "),
  );

  // 5. nothing top-level in the parent
  if (canReadParent) {
    const after = baseline ? { after: baseline, limit: 10 } : { limit: 10 };
    const newer = [...(await parent.messages.fetch(after)).values()];
    record("creating the private thread posted nothing top-level in the parent", newer.length === 0 ? "PASS" : "FAIL", newer.length ? newer.map(msgType).join(", ") : "");
  }

  // 6. a freshly connected gateway session (stand-in for a restart) while the thread is ACTIVE
  fresh = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
  const gotMessage = new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    fresh!.on("messageCreate", (m) => {
      if (m.channelId === thread!.id && m.content.includes("second message")) {
        clearTimeout(t);
        resolve(true);
      }
    });
  });
  await fresh.login(cfg.DISCORD_BOT_TOKEN);
  await new Promise<void>((r) => (fresh!.isReady() ? r() : fresh!.once("clientReady", () => r())));
  await new Promise((r) => setTimeout(r, 1500));
  const cached = fresh.channels.cache.get(thread.id);
  record("fresh session has the active private thread cached at connect", cached ? "PASS" : "FAIL");
  record("fresh session sees ownerId === bot user", cached && "ownerId" in cached && cached.ownerId === botId ? "PASS" : "FAIL");
  await thread.send({ content: "second message (for the fresh session)", allowedMentions: { parse: [] } });
  record("fresh session receives MESSAGE_CREATE in the private thread without joining", (await gotMessage) ? "PASS" : "FAIL");
  await fresh.destroy();
  fresh = undefined;

  // 7. close = archive + lock; then read it back with a brand-new REST read
  await thread.edit({ archived: true, locked: true, reason: "verify-private-threads" });
  record("archive + lock in one edit", "PASS");
  const reread = await client.channels.fetch(thread.id, { force: true });
  if (reread && reread.isThread()) {
    record("ownerId retained after archive + lock", reread.ownerId === botId ? "PASS" : "FAIL");
    record("thread reads back archived and locked", reread.archived && reread.locked ? "PASS" : "FAIL", `archived=${reread.archived} locked=${reread.locked}`);
    const old = [...(await reread.messages.fetch({ after: "0", limit: 20 })).values()].sort(byId);
    record("ref line still readable on the archived thread", old.some((m) => m.author.id === botId && m.content.includes("-# ref staff_handoff")) ? "PASS" : "FAIL");
  } else {
    record("re-fetch archived thread by id", "FAIL");
  }
} catch (e) {
  record("script error", "FAIL", errName(e));
} finally {
  try {
    await fresh?.destroy();
  } catch {
    /* ignore */
  }
  if (thread) {
    try {
      await thread.delete("verify-private-threads cleanup");
      record("cleanup: test thread deleted", "PASS");
    } catch (e) {
      record("cleanup: test thread deleted", "FAIL", `delete "${thread.name}" by hand (${errName(e)})`);
    }
  }
  await client.destroy();
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${results.filter((r) => r.status === "PASS").length} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
