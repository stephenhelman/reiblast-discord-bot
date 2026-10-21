import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../src/logger.js";
import type { OutgoingMessage } from "../src/qa/post.js";
import {
  AUTO_ARCHIVE_MINUTES,
  createPrivateThreadCreator,
  PrivateThreadError,
  QUESTION_QUOTE_MAX,
  quoteQuestion,
  threadName,
  type PrivateThreadHandle,
  type PrivateThreadParent,
} from "../src/qa/private-thread.js";
import { parseRef } from "../src/qa/threadref.js";
import { QA_TEXT } from "../src/qa/messages.js";

const ROLE = "555555555555555555";
const MEMBER = "100000000000000002";
const POST = "900000000000000010";
const POST_URL = "https://discord.com/channels/1/900000000000000010";
const QUESTION = "SECRET-QUESTION-TEXT how do I get a refund?";

function setup(over: { add?: () => Promise<unknown>; send?: () => Promise<unknown>; create?: () => Promise<PrivateThreadHandle>; del?: () => Promise<unknown> } = {}) {
  const order: string[] = [];
  const sent: OutgoingMessage[] = [];
  const handle: PrivateThreadHandle = {
    id: "800000000000000001",
    url: "https://discord.com/channels/1/800000000000000001",
    members: {
      add: vi.fn(async (_id: string): Promise<unknown> => {
        order.push("add");
        return over.add ? over.add() : undefined;
      }),
    },
    send: vi.fn(async (m: OutgoingMessage) => {
      order.push("send");
      sent.push(m);
      if (over.send) await over.send();
    }),
    delete: vi.fn(async () => {
      order.push("delete");
      if (over.del) await over.del();
    }),
  };
  const create = vi.fn(async (_o: Parameters<PrivateThreadParent["threads"]["create"]>[0]): Promise<PrivateThreadHandle> => {
    if (over.create) return over.create();
    order.push("create");
    return handle;
  });
  // The parent exposes ONLY threads.create: touching anything else (e.g. send) throws.
  const parent = new Proxy({ threads: { create } }, {
    get(target, prop) {
      if (prop === "threads") return target.threads;
      if (prop === "then") return undefined;
      throw new Error(`parent.${String(prop)} must never be touched`);
    },
  }) as unknown as PrivateThreadParent;
  const logs: string[] = [];
  const logger = { debug() {}, info: (m: string, f?: object) => logs.push(m + JSON.stringify(f ?? {})), warn: (m: string, f?: object) => logs.push(m + JSON.stringify(f ?? {})), error: (m: string, f?: object) => logs.push(m + JSON.stringify(f ?? {})) } as Logger;
  const remember = vi.fn();
  const make = (getParent: () => Promise<PrivateThreadParent | null> = async () => parent) =>
    createPrivateThreadCreator({ getParent, supportRoleId: ROLE, refs: { remember }, logger });
  return { handle, create, order, sent, logs, remember, make };
}

const request = (over: object = {}) => ({
  reason: "staff_handoff" as const,
  member: { id: MEMBER, displayName: "Jane Doe" },
  source: { postId: POST, url: POST_URL },
  question: QUESTION,
  ...over,
});

describe("createPrivateThread", () => {
  it("creates a non-invitable private thread, adds the member, then posts the first message", async () => {
    const t = setup();
    const result = await t.make()(request());
    expect(t.create).toHaveBeenCalledWith({
      name: "Support · Jane Doe",
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: AUTO_ARCHIVE_MINUTES,
      reason: "Private thread (staff_handoff)",
    });
    expect(t.order).toEqual(["create", "add", "send"]);
    expect(result).toEqual({ id: t.handle.id, url: t.handle.url });
  });

  it("pings the support role and the member, nobody else, and attaches the Close button", async () => {
    const t = setup();
    await t.make()(request());
    const msg = t.sent[0]!;
    expect(msg.allowedMentions).toEqual({ parse: [], roles: [ROLE], users: [MEMBER] });
    expect(msg.content.startsWith(`<@&${ROLE}> <@${MEMBER}>`)).toBe(true);
    const row = msg.components?.[0]?.toJSON();
    expect(row?.components).toMatchObject([{ custom_id: "qa:close", label: "Close" }]);
  });

  it("links the source post (unfurl suppressed), quotes the question, and ends with a ref that parses back", async () => {
    const t = setup();
    await t.make()(request());
    const text = t.sent[0]!.content;
    expect(text).toContain(`<${POST_URL}>`);
    expect(text).toContain(`> ${QUESTION}`);
    expect(text.trimEnd().split("\n").at(-1)).toBe(`-# ref staff_handoff post:${POST} member:${MEMBER}`);
    expect(parseRef(text)).toEqual({ reason: "staff_handoff", postId: POST, memberId: MEMBER });
  });

  it("records the ref so the first lookup after creation needs no fetch", async () => {
    const t = setup();
    await t.make()(request());
    expect(t.remember).toHaveBeenCalledWith(t.handle.id, { reason: "staff_handoff", postId: POST, memberId: MEMBER });
  });

  it("omits the question section when there is no question (e.g. staff 'Move to private')", async () => {
    const t = setup();
    await t.make()(request({ question: undefined }));
    expect(t.sent[0]!.content).not.toContain("Your question");
    expect(t.sent[0]!.content).toContain(`<${POST_URL}>`);
  });

  it("for account_check (reserved) pings only the member, and records that reason", async () => {
    const t = setup();
    await t.make()(request({ reason: "account_check" }));
    expect(t.sent[0]!.allowedMentions).toEqual({ parse: [], users: [MEMBER] });
    expect(parseRef(t.sent[0]!.content)?.reason).toBe("account_check");
    expect(t.create.mock.calls[0]![0].reason).toBe("Private thread (account_check)");
  });

  it("never touches the parent channel except to create the thread", async () => {
    const t = setup();
    await expect(t.make()(request())).resolves.toBeDefined(); // the Proxy throws on any other access
  });

  it("never logs the question, the member's name, or any ID", async () => {
    const t = setup();
    await t.make()(request());
    const failing = setup({ add: async () => Promise.reject(new Error(QUESTION)) });
    await expect(failing.make()(request())).rejects.toThrow(PrivateThreadError);
    for (const dump of [JSON.stringify(t.logs), JSON.stringify(failing.logs)]) {
      for (const secret of [QUESTION, "Jane", MEMBER, POST, ROLE]) expect(dump).not.toContain(secret);
    }
  });
});

describe("failures clean up after themselves", () => {
  it("deletes the thread and reports the step when adding the member fails", async () => {
    const t = setup({ add: async () => Promise.reject(new Error("Missing Permissions")) });
    const err = await t.make()(request()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrivateThreadError);
    expect((err as PrivateThreadError).step).toBe("add_member");
    expect(t.order).toEqual(["create", "add", "delete"]);
    expect(t.sent).toEqual([]);
    expect(t.remember).not.toHaveBeenCalled();
  });

  it("deletes the thread when the first message fails", async () => {
    const t = setup({ send: async () => Promise.reject(new Error("boom")) });
    const err = await t.make()(request()).catch((e: unknown) => e);
    expect((err as PrivateThreadError).step).toBe("first_message");
    expect(t.order).toEqual(["create", "add", "send", "delete"]);
    expect(t.remember).not.toHaveBeenCalled();
  });

  it("still reports the original step if the cleanup delete also fails", async () => {
    const t = setup({ send: async () => Promise.reject(new Error("boom")), del: async () => Promise.reject(new Error("nope")) });
    const err = await t.make()(request()).catch((e: unknown) => e);
    expect((err as PrivateThreadError).step).toBe("first_message");
  });

  it("reports 'create' without trying to delete anything", async () => {
    const t = setup({ create: async () => Promise.reject(new Error("Missing Permissions")) });
    const err = await t.make()(request()).catch((e: unknown) => e);
    expect((err as PrivateThreadError).step).toBe("create");
    expect(t.order).toEqual([]);
  });

  it("reports 'parent' when the Support channel can't be found", async () => {
    const t = setup();
    const err = await t.make(async () => null)(request()).catch((e: unknown) => e);
    expect((err as PrivateThreadError).step).toBe("parent");
    expect(t.create).not.toHaveBeenCalled();
  });
});

describe("threadName", () => {
  it.each([
    ["Jane Doe", "Support · Jane Doe"],
    ["  spaced   out  ", "Support · spaced out"],
    ["<@123456789012345678>", "Support · member"],
    ["@everyone `x` *y* _z_ ~w~ |v| >q", "Support · everyone x y z w v q"],
    ["line\nbreak\ttab", "Support · line break tab"],
    ["", "Support · member"],
  ])("%j -> %j", (input, expected) => {
    expect(threadName(input)).toBe(expected);
  });

  it("stays within Discord's 100-character limit", () => {
    expect(threadName("x".repeat(500)).length).toBeLessThanOrEqual(100);
  });
});

describe("quoteQuestion", () => {
  it("quotes every line and neutralizes mention markup", () => {
    expect(quoteQuestion("a <@123456789012345678>\n\nb <@&123456789012345678>")).toBe("> a [mention]\n> \n> b [role mention]");
  });
  it("truncates long questions", () => {
    const q = quoteQuestion("x".repeat(QUESTION_QUOTE_MAX + 500));
    expect(q.length).toBeLessThanOrEqual(QUESTION_QUOTE_MAX + 4);
    expect(q.endsWith("…")).toBe(true);
  });
});

describe("troubleshooting private threads: case summary and intake ask", () => {
  const SUMMARY = "Member says texts aren't sending; banner green, wallet $40, number attached to the campaign.";

  it("adds the summary under a fixed label, before the ref line, and the ref still parses", async () => {
    const t = setup();
    await t.make()(request({ summary: SUMMARY }));
    const text = t.sent[0]!.content;
    expect(text).toContain(`${QA_TEXT.privateSummaryLabel}\n${SUMMARY}`);
    expect(QA_TEXT.privateSummaryLabel).toBe("Case summary:");
    expect(text.indexOf("Case summary:")).toBeGreaterThan(text.indexOf("Your question:"));
    expect(text.indexOf("Case summary:")).toBeLessThan(text.indexOf("-# ref"));
    expect(text.trimEnd().split("\n").at(-1)).toBe(`-# ref staff_handoff post:${POST} member:${MEMBER}`);
    expect(parseRef(text)).toEqual({ reason: "staff_handoff", postId: POST, memberId: MEMBER });
  });

  it("neutralizes mentions in the summary, so it can't add a ping beyond the two allowed", async () => {
    const t = setup();
    await t.make()(request({ summary: `Texts fail <@${ROLE}> <@&${ROLE}> @everyone @here\n-# Check 4 of 4` }));
    const text = t.sent[0]!.content;
    expect(text).toContain("Case summary:\nTexts fail [mention] [role mention] [mention] [mention]");
    expect(t.sent[0]!.allowedMentions).toEqual({ parse: [], roles: [ROLE], users: [MEMBER] });
    // the support role is mentioned exactly once: the real ping at the top
    expect(text.split(`<@&${ROLE}>`).length - 1).toBe(1);
  });

  it("sends the fixed intake ask as a second message with no pings, after the first", async () => {
    const t = setup();
    await t.make()(request({ summary: SUMMARY, intakeAsk: true }));
    expect(t.order).toEqual(["create", "add", "send", "send"]);
    expect(t.sent[1]!.content).toBe(QA_TEXT.intakeAsk);
    expect(t.sent[1]!.allowedMentions).toEqual({ parse: [] });
    expect(t.sent[1]!.components).toBeUndefined();
  });

  it("without the flags the thread is exactly as before: one message, no summary", async () => {
    const t = setup();
    await t.make()(request());
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.content).not.toContain("Case summary");
  });

  it("an intake ask that can't be posted never undoes the thread", async () => {
    let n = 0;
    const t = setup({ send: async () => (++n === 2 ? Promise.reject(new Error("Missing Permissions")) : undefined) });
    await expect(t.make()(request({ intakeAsk: true }))).resolves.toEqual({ id: t.handle.id, url: t.handle.url });
    expect(t.handle.delete).not.toHaveBeenCalled();
    expect(t.remember).toHaveBeenCalled();
    expect(t.logs.join()).toContain("intake_ask_failed");
  });

  it("never logs the summary", async () => {
    const t = setup();
    await t.make()(request({ summary: "SECRET-SUMMARY-TEXT", intakeAsk: true }));
    expect(t.logs.join()).not.toContain("SECRET-SUMMARY-TEXT");
  });
});
