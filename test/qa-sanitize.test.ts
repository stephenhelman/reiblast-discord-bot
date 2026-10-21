import { describe, expect, it } from "vitest";
import { sanitizeSummary, stripSubtext, SUMMARY_MAX } from "../src/qa/sanitize.js";

describe("stripSubtext", () => {
  it("removes lines that start with the subtext marker, so a reply can't forge a counter", () => {
    expect(stripSubtext("Go to Billing.\n-# Check 3 of 4")).toBe("Go to Billing.");
    expect(stripSubtext("-# Check 1 of 4\nQuestion?\n  -# Quick question")).toBe("Question?");
  });
  it("leaves ordinary text and mid-line dashes alone", () => {
    expect(stripSubtext("Use a - then # sign")).toBe("Use a - then # sign");
    expect(stripSubtext("")).toBe("");
  });
});

describe("sanitizeSummary", () => {
  it("neutralizes every kind of mention", () => {
    const out = sanitizeSummary("Hi <@123456789012345678> and <@!123456789012345678> <@&123456789012345678> <#123456789012345678> @everyone @here @EVERYONE");
    expect(out).toBe("Hi [mention] and [mention] [role mention] [channel] [mention] [mention] [mention]");
    expect(out).not.toMatch(/<@|@everyone|@here/i);
  });

  it("collapses to one plain line: no subtext, headings, code fences or newlines", () => {
    const out = sanitizeSummary("# Heading\nMember says texts fail.\n-# Check 2 of 4\n```\ncode\n```\n\n  Wallet is fine.");
    expect(out).toBe("Heading Member says texts fail. code Wallet is fine.");
    expect(out).not.toMatch(/\n|-#|```/);
  });

  it("removes invisible characters", () => {
    expect(sanitizeSummary("a​b⁠c﻿d")).toBe("abcd");
  });

  it("caps the length", () => {
    const out = sanitizeSummary("word ".repeat(300));
    expect(out.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(sanitizeSummary("short")).toBe("short");
  });

  it("returns empty for nothing usable", () => {
    expect(sanitizeSummary("")).toBe("");
    expect(sanitizeSummary("-# only subtext")).toBe("");
    expect(sanitizeSummary("   \n  ")).toBe("");
  });
});
