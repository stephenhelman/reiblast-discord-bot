import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ButtonStyle } from "discord.js";
import { buildAnswerRow } from "../src/qa/components.js";
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

  it("every interaction reply in buttons.ts is ephemeral", () => {
    const src = strip(readFileSync(join(dir, "buttons.ts"), "utf8"));
    const calls = src.match(/i\.(reply|followUp)\(\{[^}]*\}\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toContain("flags: EPH");
  });
});
