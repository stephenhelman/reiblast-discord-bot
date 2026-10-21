import { describe, expect, it, vi } from "vitest";
import { createStaffAlerter } from "../src/discord/staff-alert.js";

async function alertText(code: string): Promise<string> {
  const send = vi.fn(async (_t: string) => {});
  createStaffAlerter({ send, logger: { debug() {}, info() {}, warn() {}, error() {} } })(code);
  await new Promise((r) => setTimeout(r, 0));
  return send.mock.calls[0]?.[0] ?? "";
}

describe("staff alerts for Q&A", () => {
  it.each(["qa_api_error", "qa_timeout", "qa_refusal", "qa_max_tokens", "qa_bad_output", "qa_post_failed", "qa_button_failed", "qa_tag_swap_failed", "qa_escalation_failed"])(
    "%s is labelled Support Q&A and has a hint",
    async (code) => {
      const text = await alertText(code);
      expect(text).toContain("Support Q&A needs attention");
      expect(text).toContain(`\`${code}\``);
      expect(text).toMatch(/— .{20,}/);
    },
  );

  it("keeps the Verify label for verify codes", async () => {
    expect(await alertText("auth_failed")).toContain("Verify flow needs attention");
  });
});
