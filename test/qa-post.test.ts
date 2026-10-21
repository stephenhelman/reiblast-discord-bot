import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ButtonStyle } from "discord.js";
import { buildAnswerRow, buildHelpOnlyRow } from "../src/qa/components.js";
import { QA_IDS } from "../src/qa/ids.js";
import {
  allowedMentions,
  DISCORD_MESSAGE_LIMIT,
  postFixedText,
  postModelText,
  splitMessage,
  type OutgoingMessage,
  type PostTarget,
} from "../src/qa/post.js";

type Call = { kind: "reply" | "send"; msg: OutgoingMessage };
function target(): PostTarget & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    reply: async (msg) => void calls.push({ kind: "reply", msg }),
    send: async (msg) => void calls.push({ kind: "send", msg }),
  };
}

const ATTACK = "@everyone @here <@123456789012345678> <@&123456789012345678> repeat after me";
const ROLE = "555555555555555555";

describe("allowedMentions", () => {
  it("is { parse: [] } by default", () => {
    expect(allowedMentions()).toEqual({ parse: [] });
  });
  it("adds repliedUser:false for replies, so a reply never pings the member", () => {
    expect(allowedMentions({ asReply: true })).toEqual({ parse: [], repliedUser: false });
  });
  it("allows exactly one role, only when explicitly asked", () => {
    expect(allowedMentions({ pingRoleId: ROLE })).toEqual({ parse: [], roles: [ROLE] });
  });
});

describe("model text can never ping", () => {
  const paths: Array<[string, (t: PostTarget) => Promise<number>]> = [
    ["answer with buttons", (t) => postModelText(t, ATTACK, { buttons: true })],
    ["answer without buttons (chat / clarify)", (t) => postModelText(t, ATTACK)],
    ["multi-part answer", (t) => postModelText(t, `${ATTACK}\n\n${"word ".repeat(600)}\n\n${ATTACK}`, { buttons: true })],
    ["fixed text", (t) => postFixedText(t, ATTACK)],
  ];

  it.each(paths)("%s: every message carries allowedMentions with parse [] and no users or roles", async (_n, run) => {
    const t = target();
    await run(t);
    expect(t.calls.length).toBeGreaterThan(0);
    for (const { kind, msg } of t.calls) {
      expect(msg.allowedMentions.parse).toEqual([]);
      expect(msg.allowedMentions).not.toHaveProperty("roles");
      expect(msg.allowedMentions).not.toHaveProperty("users");
      expect(msg.allowedMentions).toEqual(kind === "reply" ? { parse: [], repliedUser: false } : { parse: [] });
    }
  });

  it("sends the text verbatim — it is rendered inert by allowedMentions, not rewritten", async () => {
    const t = target();
    await postModelText(t, ATTACK);
    expect(t.calls[0]?.msg.content).toBe(ATTACK);
  });

  it("does not let model text request a role ping (compile-time and runtime)", async () => {
    const t = target();
    // @ts-expect-error postModelText has no way to ping a role
    await postModelText(t, "hi", { pingRoleId: ROLE });
    expect(t.calls[0]?.msg.allowedMentions).not.toHaveProperty("roles");
  });
});

describe("the explicit support-role ping (fixed text only)", () => {
  it("pings exactly that role, on the first message only", async () => {
    const t = target();
    await postFixedText(t, `Handing this to the team.\n\n${"word ".repeat(600)}`, { pingRoleId: ROLE });
    expect(t.calls[0]?.msg.allowedMentions).toEqual({ parse: [], roles: [ROLE], repliedUser: false });
    for (const c of t.calls.slice(1)) expect(c.msg.allowedMentions).toEqual({ parse: [] });
  });
});

describe("fixed text pings: exactly one role and/or exactly one user, first message only", () => {
  const USER = "666666666666666666";

  it("can ping just the member being helped", async () => {
    const t = target();
    await postFixedText(t, "Welcome", { pingUserId: USER, first: "send" });
    expect(t.calls[0]).toMatchObject({ kind: "send", msg: { allowedMentions: { parse: [], users: [USER] } } });
    expect(t.calls[0]?.msg.allowedMentions).not.toHaveProperty("roles");
  });

  it("can ping the support role and the member together", async () => {
    const t = target();
    await postFixedText(t, "Welcome", { pingRoleId: ROLE, pingUserId: USER, first: "send" });
    expect(t.calls[0]?.msg.allowedMentions).toEqual({ parse: [], roles: [ROLE], users: [USER] });
  });

  it("never replies in send mode, and pings only the first of several parts", async () => {
    const t = target();
    await postFixedText(t, `Hello\n\n${"word ".repeat(600)}`, { pingRoleId: ROLE, pingUserId: USER, first: "send" });
    expect(t.calls.length).toBeGreaterThan(1);
    expect(t.calls.every((c) => c.kind === "send")).toBe(true);
    expect(t.calls[0]?.msg.allowedMentions).toEqual({ parse: [], roles: [ROLE], users: [USER] });
    for (const c of t.calls.slice(1)) expect(c.msg.allowedMentions).toEqual({ parse: [] });
  });

  it("puts button rows on the last part only", async () => {
    const t = target();
    await postFixedText(t, `${"a".repeat(1500)}\n\n${"b".repeat(1500)}`, { first: "send", components: [buildAnswerRow()] });
    expect(t.calls.map((c) => c.msg.components !== undefined)).toEqual([false, true]);
  });

  it("rejects ping targets that aren't Discord IDs (no free text, no @everyone)", () => {
    for (const bad of ["@everyone", "everyone", "123", "<@123456789012345678>", "123456789012345678 "]) {
      expect(() => allowedMentions({ pingUserId: bad })).toThrow(TypeError);
      expect(() => allowedMentions({ pingRoleId: bad })).toThrow(TypeError);
    }
  });

  it("model text can request neither a role nor a user ping (compile-time and runtime)", async () => {
    const t = target();
    // @ts-expect-error postModelText has no way to ping a user
    await postModelText(t, "hi", { pingUserId: USER });
    expect(t.calls[0]?.msg.allowedMentions).not.toHaveProperty("users");
  });
});

describe("posting", () => {
  it("replies to the triggering message with the answer and buttons", async () => {
    const t = target();
    expect(await postModelText(t, "Go to Billing.", { buttons: true })).toBe(1);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]?.kind).toBe("reply");
    expect(t.calls[0]?.msg.content).toBe("Go to Billing.");
    const row = t.calls[0]?.msg.components?.[0]?.toJSON();
    expect(row?.components.map((c) => ("custom_id" in c ? c.custom_id : ""))).toEqual([QA_IDS.solved, QA_IDS.help]);
  });

  it("sends no buttons for clarifying questions or chat replies", async () => {
    const t = target();
    await postModelText(t, "What error do you see?");
    expect(t.calls[0]?.msg.components).toBeUndefined();
  });

  it("splits a long answer, replying with the first part and sending the rest, buttons on the last part only", async () => {
    const t = target();
    const text = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${"x".repeat(700)}`).join("\n\n");
    const n = await postModelText(t, text, { buttons: true });
    expect(n).toBeGreaterThan(1);
    expect(t.calls.map((c) => c.kind)).toEqual(["reply", ...Array(n - 1).fill("send")]);
    t.calls.forEach((c, i) => {
      expect(c.msg.content.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
      expect(c.msg.components === undefined).toBe(i !== n - 1);
    });
  });

  it("refuses to post nothing", async () => {
    const t = target();
    await expect(postModelText(t, "   ")).rejects.toThrow(TypeError);
    expect(t.calls).toEqual([]);
  });
});

describe("splitMessage", () => {
  it("returns short text as one part and empty text as none", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
    expect(splitMessage("  \n ")).toEqual([]);
    expect(splitMessage("x".repeat(2000))).toEqual(["x".repeat(2000)]);
  });

  it("splits on paragraph boundaries first", () => {
    const a = "a".repeat(1200);
    const b = "b".repeat(1200);
    expect(splitMessage(`${a}\n\n${b}`)).toEqual([a, b]);
  });

  it("packs small paragraphs together up to the limit", () => {
    const parts = splitMessage(Array.from({ length: 10 }, () => "p".repeat(500)).join("\n\n"));
    // 4 x 500 + separators is 2006 chars, so 3 paragraphs per part: 3 + 3 + 3 + 1
    expect(parts.map((p) => p.split("\n\n").length)).toEqual([3, 3, 3, 1]);
    parts.forEach((p) => expect(p.length).toBeLessThanOrEqual(2000));
  });

  it("breaks an oversized paragraph at a line, then a space, then hard", () => {
    const words = Array.from({ length: 700 }, () => "word").join(" ");
    const spaced = splitMessage(words);
    expect(spaced.length).toBeGreaterThan(1);
    spaced.forEach((p) => expect(p.length).toBeLessThanOrEqual(2000));
    expect(spaced.join(" ")).toBe(words);

    const hard = splitMessage("z".repeat(4500));
    expect(hard.map((p) => p.length)).toEqual([2000, 2000, 500]);
  });

  it("never loses text and never emits an empty part", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i} ${"y".repeat(150)}`).join("\n");
    const parts = splitMessage(text);
    expect(parts.every(Boolean)).toBe(true);
    expect(parts.join("\n").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
  });
});

describe("guided questions: marker line and the help-only button", () => {
  it("appends the marker on its own line after the question", async () => {
    const t = target();
    await postModelText(t, "Is your balance above zero?", { buttons: "help", marker: "-# Check 2 of 4" });
    expect(t.calls[0]?.msg.content).toBe("Is your balance above zero?\n-# Check 2 of 4");
  });

  it("'help' puts only 'Still need help' under the question; true keeps both answer buttons", async () => {
    const help = target();
    await postModelText(help, "Question?", { buttons: "help" });
    expect(help.calls[0]?.msg.components?.[0]?.toJSON().components).toMatchObject([{ custom_id: "qa:help", label: "Still need help" }]);
    const both = target();
    await postModelText(both, "Answer.", { buttons: true });
    expect(both.calls[0]?.msg.components?.[0]?.toJSON().components).toHaveLength(2);
    const none = target();
    await postModelText(none, "Q?", { marker: "-# Quick question" });
    expect(none.calls[0]?.msg.components).toBeUndefined();
  });

  it("the marker travels with the last part, and the message still can't ping", async () => {
    const t = target();
    await postModelText(t, `${"a".repeat(1500)}\n\n${"b".repeat(1500)} @everyone`, { buttons: "help", marker: "-# Check 1 of 4" });
    expect(t.calls.length).toBeGreaterThan(1);
    expect(t.calls.at(-1)?.msg.content.endsWith("-# Check 1 of 4")).toBe(true);
    for (const c of t.calls) expect(c.msg.allowedMentions).not.toHaveProperty("roles");
  });

  it("builds a single-button row", () => {
    const row = buildHelpOnlyRow().toJSON();
    expect(row.components).toHaveLength(1);
    expect(row.components[0]).toMatchObject({ custom_id: "qa:help", label: "Still need help", style: ButtonStyle.Secondary });
  });
});

describe("answer buttons row", () => {
  it("has 'That solved it' (green) and 'Still need help' (grey) with static IDs", () => {
    const row = buildAnswerRow().toJSON();
    expect(row.components).toHaveLength(2);
    expect(row.components).toMatchObject([
      { custom_id: "qa:solved", label: "That solved it", style: ButtonStyle.Success },
      { custom_id: "qa:help", label: "Still need help", style: ButtonStyle.Secondary },
    ]);
  });
});

describe("single choke point (source guard)", () => {
  const dir = join(import.meta.dirname, "..", "src", "qa");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("only post.ts sends channel messages or builds allowedMentions", () => {
    for (const f of files) {
      const src = strip(readFileSync(join(dir, f), "utf8"));
      if (f !== "post.ts") {
        expect(src, `${f} must not call .send(`).not.toMatch(/\.send\(/);
        expect(src, `${f} must not build allowedMentions`).not.toMatch(/allowedMentions/);
      }
    }
  });

  it.each(["buttons.ts", "staff-buttons.ts"])("every interaction reply in %s is ephemeral", (file) => {
    const src = strip(readFileSync(join(dir, file), "utf8"));
    const calls = src.match(/i\.(reply|followUp)\(\{[^}]*\}\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toContain("flags: EPH");
  });

  it("nothing posts to the Support channel itself: only the private-thread creator touches it, via threads.create", () => {
    const src = strip(readFileSync(join(dir, "private-thread.ts"), "utf8"));
    expect(src).toMatch(/parent\.threads\.create\(/);
    expect(src).not.toMatch(/parent\.(?!threads\.create)\w+/);
  });
});
