import { describe, expect, it } from "vitest";
import { CLARIFY_MARKER, diagnoseMarker, parseMarker, stripMarkers } from "../src/qa/markers.js";
import { sanitizeSummary, stripSubtext } from "../src/qa/sanitize.js";

describe("marker format", () => {
  it("diagnose markers are numbered out of the cap; clarify is 'Quick question'", () => {
    expect(diagnoseMarker(1)).toBe("-# Check 1 of 4");
    expect(diagnoseMarker(4)).toBe("-# Check 4 of 4");
    expect(CLARIFY_MARKER).toBe("-# Quick question");
  });
});

describe("parseMarker", () => {
  it("reads the marker from the last non-empty line", () => {
    expect(parseMarker("Is your balance above zero?\n-# Check 2 of 4")).toEqual({ kind: "diagnose", n: 2 });
    expect(parseMarker("Which error?\n-# Quick question\n")).toEqual({ kind: "clarify" });
    expect(parseMarker("Which error?\r\n-# Quick question\r\n\r\n")).toEqual({ kind: "clarify" });
  });

  it.each([
    ["no marker", "Go to Billing."],
    ["marker not on the last line", "-# Check 2 of 4\nBut then more text"],
    ["marker mid-sentence", "see -# Check 2 of 4 here"],
    ["number out of range", "Q?\n-# Check 0 of 4"],
    ["number above the cap", "Q?\n-# Check 5 of 4"],
    ["other subtext", "Q?\n-# ref staff_handoff post:123456789012345678 member:123456789012345678"],
    ["extra text on the marker line", "Q?\n-# Check 2 of 4 please"],
    ["empty", ""],
  ])("ignores %s", (_n, content) => {
    expect(parseMarker(content)).toBeNull();
  });
});

describe("stripMarkers", () => {
  it("removes marker lines only, so the model never sees them in earlier turns", () => {
    expect(stripMarkers("Is your balance above zero?\n-# Check 2 of 4")).toBe("Is your balance above zero?");
    expect(stripMarkers("Which error?\n-# Quick question")).toBe("Which error?");
    expect(stripMarkers("Keep -# this\n-# Check 1 of 4")).toBe("Keep -# this");
    expect(stripMarkers("plain")).toBe("plain");
  });
});

describe("model text can't carry a marker", () => {
  it("stripSubtext and sanitizeSummary drop every '-#' line, so only code writes markers", () => {
    for (const forged of ["Q?\n-# Check 4 of 4", "-# Quick question\nQ?"]) {
      expect(parseMarker(stripSubtext(forged))).toBeNull();
    }
    expect(sanitizeSummary("Member says texts fail.\n-# Check 4 of 4")).toBe("Member says texts fail.");
  });
});
