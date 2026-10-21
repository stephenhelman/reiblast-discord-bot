import { ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";
import { ForumTagsError, formatForumTags } from "../src/discord/forum-tags.js";

describe("formatForumTags", () => {
  it("prints name and id per tag", () => {
    const lines = formatForumTags({
      type: ChannelType.GuildForum,
      available_tags: [
        { id: "111111111111111111", name: "Support" },
        { id: "222222222222222222", name: "Needs Staff" },
      ],
    });
    expect(lines).toEqual(["Support\t111111111111111111", "Needs Staff\t222222222222222222"]);
  });

  it("rejects a non-forum channel", () => {
    expect(() => formatForumTags({ type: ChannelType.GuildText })).toThrow(ForumTagsError);
  });

  it("rejects a forum with no tags", () => {
    expect(() => formatForumTags({ type: ChannelType.GuildForum, available_tags: [] })).toThrow(/no tags/);
  });
});
