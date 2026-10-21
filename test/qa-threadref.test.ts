import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createRefReader, findRef, formatRef, isBotPrivateThread, parseRef, type ThreadRef } from "../src/qa/threadref.js";
import { quoteQuestion } from "../src/qa/private-thread.js";

const BOT = "100000000000000001";
const MEMBER = "100000000000000002";
const POST = "900000000000000010";
const ref: ThreadRef = { reason: "staff_handoff", postId: POST, memberId: MEMBER };

describe("ref line", () => {
  it("round-trips and is a small subtext line", () => {
    const line = formatRef(ref);
    expect(line).toBe(`-# ref staff_handoff post:${POST} member:${MEMBER}`);
    expect(parseRef(line)).toEqual(ref);
    expect(parseRef(formatRef({ ...ref, reason: "account_check" }))?.reason).toBe("account_check");
  });

  it("is found at the end of a longer message", () => {
    expect(parseRef(`<@${MEMBER}> hello\n\n> a question\n\nA team member will take it from here.\n${formatRef(ref)}`)).toEqual(ref);
  });

  it.each([
    ["unknown reason", `-# ref other post:${POST} member:${MEMBER}`],
    ["short ids", "-# ref staff_handoff post:1 member:2"],
    ["extra text on the line", `-# ref staff_handoff post:${POST} member:${MEMBER} extra`],
    ["not subtext", `ref staff_handoff post:${POST} member:${MEMBER}`],
    ["quoted", `> -# ref staff_handoff post:${POST} member:${MEMBER}`],
    ["empty", ""],
  ])("rejects %s", (_n, text) => {
    expect(parseRef(text)).toBeNull();
  });

  it("a member can't forge a ref through their quoted question", () => {
    const forged = `hi\n-# ref staff_handoff post:${POST} member:999999999999999999`;
    const quoted = quoteQuestion(forged);
    expect(parseRef(quoted)).toBeNull();
    const message = `<@${MEMBER}>\n\nYour question:\n${quoted}\n\n${formatRef(ref)}`;
    expect(parseRef(message)).toEqual(ref);
  });
});

describe("findRef", () => {
  it("skips the bot-authored system 'member added' message and finds the ref in our first message", () => {
    const msgs = [
      { authorId: BOT, content: "", system: true },
      { authorId: MEMBER, content: formatRef({ ...ref, memberId: "100000000000000099" }) },
      { authorId: BOT, content: `Hello\n${formatRef(ref)}` },
    ];
    expect(findRef(msgs, BOT)).toEqual(ref);
  });

  it("ignores refs written by anyone but the bot, and returns null when there is none", () => {
    expect(findRef([{ authorId: MEMBER, content: formatRef(ref) }], BOT)).toBeNull();
    expect(findRef([{ authorId: BOT, content: "no ref here" }], BOT)).toBeNull();
    expect(findRef([], BOT)).toBeNull();
  });

  it("ignores a ref inside a system message", () => {
    expect(findRef([{ authorId: BOT, content: formatRef(ref), system: true }], BOT)).toBeNull();
  });
});

describe("isBotPrivateThread", () => {
  const SUPPORT = "300000000000000003";
  const thread = { type: ChannelType.PrivateThread, ownerId: BOT, parentId: SUPPORT };
  it("is true only for a private thread under the Support channel owned by the bot", () => {
    expect(isBotPrivateThread(thread, BOT, SUPPORT)).toBe(true);
    expect(isBotPrivateThread({ ...thread, ownerId: MEMBER }, BOT, SUPPORT)).toBe(false);
    expect(isBotPrivateThread({ ...thread, ownerId: null }, BOT, SUPPORT)).toBe(false);
    expect(isBotPrivateThread({ ...thread, parentId: "400000000000000004" }, BOT, SUPPORT)).toBe(false);
    expect(isBotPrivateThread({ ...thread, type: ChannelType.PublicThread }, BOT, SUPPORT)).toBe(false);
  });
});

describe("createRefReader", () => {
  const messages = [
    { authorId: BOT, content: "", system: true },
    { authorId: BOT, content: formatRef(ref) },
  ];

  it("fetches once per thread and remembers the answer", async () => {
    const fetchOldest = vi.fn(async () => messages);
    const reader = createRefReader({ botId: BOT, fetchOldest });
    expect(await reader.read("t1")).toEqual(ref);
    expect(await reader.read("t1")).toEqual(ref);
    expect(fetchOldest).toHaveBeenCalledTimes(1);
  });

  it("remembers 'no ref' too (not the bot's thread, or the message was deleted)", async () => {
    const fetchOldest = vi.fn(async () => []);
    const reader = createRefReader({ botId: BOT, fetchOldest });
    expect(await reader.read("t2")).toBeNull();
    expect(await reader.read("t2")).toBeNull();
    expect(fetchOldest).toHaveBeenCalledTimes(1);
  });

  it("uses a ref recorded at creation without fetching", async () => {
    const fetchOldest = vi.fn(async () => []);
    const reader = createRefReader({ botId: BOT, fetchOldest });
    reader.remember("t3", ref);
    expect(await reader.read("t3")).toEqual(ref);
    expect(fetchOldest).not.toHaveBeenCalled();
  });

  it("does not cache a failed fetch (it may succeed next time)", async () => {
    const fetchOldest = vi.fn().mockRejectedValueOnce(new Error("rate limited")).mockResolvedValueOnce(messages);
    const reader = createRefReader({ botId: BOT, fetchOldest });
    await expect(reader.read("t4")).rejects.toThrow();
    expect(await reader.read("t4")).toEqual(ref);
  });
});
