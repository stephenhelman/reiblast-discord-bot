import { describe, expect, it } from "vitest";
import { decide, decideTagAdded, MAX_BOT_TURNS, type Decision, type MessageFacts, type TriggerConfig } from "../src/qa/triggers.js";

const cfg: TriggerConfig = { tagSupportId: "T_SUPPORT", tagResolvedId: "T_RESOLVED", tagNeedsStaffId: "T_STAFF" };
const OP = "u-op";

function forum(over: Partial<{ ownerId: string; appliedTags: string[]; isStarter: boolean }> = {}) {
  return { kind: "forum-thread" as const, ownerId: OP, appliedTags: [cfg.tagSupportId], isStarter: false, ...over };
}

function msg(over: Partial<MessageFacts> = {}): MessageFacts {
  return {
    inGuild: true,
    authorId: OP,
    authorIsBot: false,
    authorIsStaff: false,
    mentionsBot: false,
    hasText: true,
    where: forum(),
    ...over,
  };
}

const ignore = (reason: string): Decision => ({ action: "ignore", reason } as Decision);
const answer = (trigger: string, surface = "forum", asker = "poster"): Decision => ({ action: "answer", trigger, surface, asker } as Decision);

describe("decide: global ignores", () => {
  it.each([
    ["outside a guild", msg({ inGuild: false, mentionsBot: true }), "not_guild"],
    ["bots, webhooks, system messages and the bot itself", msg({ authorIsBot: true, mentionsBot: true }), "bot_author"],
    ["the Support channel, even with a mention", msg({ where: { kind: "support-channel" }, mentionsBot: true }), "support_channel"],
    ["nothing left to answer", msg({ hasText: false, mentionsBot: true }), "empty"],
  ])("ignores %s", (_n, m, reason) => {
    expect(decide(m, cfg, 0)).toEqual(ignore(reason));
  });
});

describe("decide: chat and other channels", () => {
  const other = { kind: "other" as const };
  it("answers an @mention with the chat surface", () => {
    expect(decide(msg({ where: other, mentionsBot: true }), cfg, undefined)).toEqual(answer("mention", "chat"));
  });
  it("stays silent without a mention", () => {
    expect(decide(msg({ where: other }), cfg, undefined)).toEqual(ignore("no_trigger"));
  });
  it("lets staff mention the bot to test it", () => {
    expect(decide(msg({ where: other, mentionsBot: true, authorIsStaff: true }), cfg, undefined).action).toBe("answer");
  });
});

describe("decide: new forum posts", () => {
  const starter = (tags: string[], over: Partial<MessageFacts> = {}) =>
    msg({ where: forum({ isStarter: true, appliedTags: tags }), ...over });

  it("answers a new post tagged Support", () => {
    expect(decide(starter([cfg.tagSupportId]), cfg, undefined)).toEqual(answer("new_post"));
  });
  it("ignores a new post without the Support tag or a mention", () => {
    expect(decide(starter([]), cfg, undefined)).toEqual(ignore("no_trigger"));
    expect(decide(starter(["T_OTHER"]), cfg, undefined)).toEqual(ignore("no_trigger"));
  });
  it("answers an @mention in a post without the Support tag", () => {
    expect(decide(starter([], { mentionsBot: true }), cfg, undefined)).toEqual(answer("mention"));
  });
  it("counts Support + mention as one new_post answer", () => {
    expect(decide(starter([cfg.tagSupportId], { mentionsBot: true }), cfg, undefined)).toEqual(answer("new_post"));
  });
  it.each([["Resolved", "T_RESOLVED"], ["Needs Staff", "T_STAFF"]])("ignores a post already tagged %s", (_n, tag) => {
    expect(decide(starter([cfg.tagSupportId, tag], { mentionsBot: true }), cfg, undefined)).toEqual(ignore("terminal_tag"));
  });
  it("answers staff who post to test it", () => {
    expect(decide(starter([cfg.tagSupportId], { authorIsStaff: true }), cfg, undefined).action).toBe("answer");
  });
});

describe("decide: follow-ups from the original poster", () => {
  it("answers once the bot has posted in the thread", () => {
    expect(decide(msg(), cfg, 1)).toEqual(answer("followup"));
    expect(decide(msg(), cfg, MAX_BOT_TURNS - 1)).toEqual(answer("followup"));
  });
  it("asks for history when the bot's turn count is unknown", () => {
    expect(decide(msg(), cfg, undefined)).toEqual({ action: "need_history" });
  });
  it("stays silent if the bot never answered and there's no mention", () => {
    expect(decide(msg(), cfg, 0)).toEqual(ignore("not_answered_yet"));
  });
  it("answers an OP @mention in an unanswered post", () => {
    expect(decide(msg({ mentionsBot: true }), cfg, 0)).toEqual(answer("mention"));
  });
  it("allows up to 10 bot turns (room for a 4-question walk-through, an answer and follow-ups)", () => {
    expect(MAX_BOT_TURNS).toBe(10);
  });
  it("escalates once the turn cap is reached", () => {
    expect(decide(msg(), cfg, MAX_BOT_TURNS)).toEqual({ action: "escalate", reason: "turn_cap" });
    expect(decide(msg(), cfg, MAX_BOT_TURNS + 3)).toEqual({ action: "escalate", reason: "turn_cap" });
  });
  it.each([["Resolved", "T_RESOLVED"], ["Needs Staff", "T_STAFF"]])("is silent in a post tagged %s", (_n, tag) => {
    expect(decide(msg({ where: forum({ appliedTags: [cfg.tagSupportId, tag] }), mentionsBot: true }), cfg, 2)).toEqual(ignore("terminal_tag"));
  });
  it("is silent once staff removed the Support tag, unless mentioned", () => {
    expect(decide(msg({ where: forum({ appliedTags: [] }) }), cfg, 2)).toEqual(ignore("no_trigger"));
    expect(decide(msg({ where: forum({ appliedTags: [] }), mentionsBot: true }), cfg, 2)).toEqual(answer("followup"));
  });
  it("ignores staff replying in their own post, unless they mention the bot", () => {
    expect(decide(msg({ authorIsStaff: true }), cfg, 1)).toEqual(ignore("staff_author"));
    expect(decide(msg({ authorIsStaff: true, mentionsBot: true }), cfg, 1)).toEqual(answer("followup"));
  });
});

describe("decide: everyone else in a forum post", () => {
  const other = (over: Partial<MessageFacts> = {}) => msg({ authorId: "u-other", ...over });

  it("ignores other members without a mention, whatever the bot's turn count", () => {
    for (const turns of [undefined, 0, 1, 9]) expect(decide(other(), cfg, turns)).toEqual(ignore("not_op"));
  });
  it("ignores staff replies in someone else's post", () => {
    expect(decide(other({ authorIsStaff: true }), cfg, 1)).toEqual(ignore("not_op"));
  });
  it("answers another member's @mention only in a post the bot hasn't answered", () => {
    expect(decide(other({ mentionsBot: true }), cfg, 0)).toEqual(answer("mention", "forum", "other"));
    expect(decide(other({ mentionsBot: true }), cfg, 1)).toEqual(ignore("already_answered"));
    expect(decide(other({ mentionsBot: true }), cfg, undefined)).toEqual({ action: "need_history" });
  });
  it("is silent in resolved / needs-staff posts", () => {
    expect(decide(other({ mentionsBot: true, where: forum({ appliedTags: [cfg.tagResolvedId] }) }), cfg, 0)).toEqual(ignore("terminal_tag"));
  });
  it("lets staff mention the bot in an unanswered post", () => {
    expect(decide(other({ mentionsBot: true, authorIsStaff: true }), cfg, 0).action).toBe("answer");
  });
  it("never answers other bots", () => {
    expect(decide(other({ authorIsBot: true, mentionsBot: true }), cfg, 0)).toEqual(ignore("bot_author"));
  });
});

describe("decideTagAdded", () => {
  const change = (over: Partial<{ inForum: boolean; oldTags: string[]; newTags: string[] }> = {}) => ({
    inForum: true,
    oldTags: [] as string[],
    newTags: [cfg.tagSupportId],
    ...over,
  });

  it("answers when Support is added to an existing post the bot hasn't answered", () => {
    expect(decideTagAdded(change(), cfg, 0)).toEqual(answer("tag_added"));
  });
  it("asks for history when unknown", () => {
    expect(decideTagAdded(change(), cfg, undefined)).toEqual({ action: "need_history" });
  });
  it("ignores posts outside the support forum", () => {
    expect(decideTagAdded(change({ inForum: false }), cfg, 0)).toEqual(ignore("not_forum"));
  });
  it("ignores updates that don't newly add Support", () => {
    expect(decideTagAdded(change({ oldTags: [cfg.tagSupportId] }), cfg, 0)).toEqual(ignore("no_trigger"));
    expect(decideTagAdded(change({ oldTags: [cfg.tagSupportId], newTags: [] }), cfg, 0)).toEqual(ignore("no_trigger"));
    expect(decideTagAdded(change({ newTags: ["T_OTHER"] }), cfg, 0)).toEqual(ignore("no_trigger"));
  });
  it("ignores when the post is already resolved / needs staff", () => {
    expect(decideTagAdded(change({ newTags: [cfg.tagSupportId, cfg.tagNeedsStaffId] }), cfg, 0)).toEqual(ignore("terminal_tag"));
    expect(decideTagAdded(change({ newTags: [cfg.tagSupportId, cfg.tagResolvedId] }), cfg, 0)).toEqual(ignore("terminal_tag"));
  });
  it("doesn't answer twice", () => {
    expect(decideTagAdded(change(), cfg, 1)).toEqual(ignore("already_answered"));
  });
  it("does not fire when the bot swaps Support for Resolved or Needs Staff", () => {
    expect(decideTagAdded(change({ oldTags: [cfg.tagSupportId], newTags: [cfg.tagResolvedId] }), cfg, 1)).toEqual(ignore("no_trigger"));
  });
});
