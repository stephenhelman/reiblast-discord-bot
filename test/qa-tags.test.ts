import { describe, expect, it } from "vitest";
import { hasTerminalTag, swapTags } from "../src/qa/tags.js";

const cfg = { tagSupportId: "S", tagResolvedId: "R", tagNeedsStaffId: "N" };

describe("swapTags", () => {
  it("replaces Support with the target and keeps other tags", () => {
    expect(swapTags(["S", "billing"], cfg, "resolved")).toEqual(["billing", "R"]);
    expect(swapTags(["S", "billing"], cfg, "needs_staff")).toEqual(["billing", "N"]);
  });
  it("works when Support isn't there (a mention in an untagged post)", () => {
    expect(swapTags([], cfg, "needs_staff")).toEqual(["N"]);
  });
  it("never leaves two of our tags, and adds the target once", () => {
    expect(swapTags(["S", "R", "N", "x"], cfg, "needs_staff")).toEqual(["x", "N"]);
    expect(swapTags(["N"], cfg, "needs_staff")).toEqual(["N"]);
  });
  it("stays within Discord's 5-tag limit when it started within it", () => {
    expect(swapTags(["S", "a", "b", "c", "d"], cfg, "resolved")).toHaveLength(5);
  });
  it("does not mutate its input", () => {
    const tags = ["S"];
    swapTags(tags, cfg, "resolved");
    expect(tags).toEqual(["S"]);
  });
});

describe("hasTerminalTag", () => {
  it("is true for Resolved or Needs Staff only", () => {
    expect(hasTerminalTag(["S", "R"], cfg)).toBe(true);
    expect(hasTerminalTag(["N"], cfg)).toBe(true);
    expect(hasTerminalTag(["S"], cfg)).toBe(false);
  });
});
