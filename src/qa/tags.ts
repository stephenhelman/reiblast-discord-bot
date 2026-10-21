import type { TriggerConfig } from "./triggers.js";

export function hasTerminalTag(tags: readonly string[], cfg: TriggerConfig): boolean {
  return tags.includes(cfg.tagResolvedId) || tags.includes(cfg.tagNeedsStaffId);
}

/**
 * The post's tags after moving it out of Support: Support / Resolved / Needs Staff are removed, every other tag is
 * kept, and the target is added once. Never exceeds the tags it started with plus one.
 */
export function swapTags(current: readonly string[], cfg: TriggerConfig, to: "resolved" | "needs_staff"): string[] {
  const ours = new Set([cfg.tagSupportId, cfg.tagResolvedId, cfg.tagNeedsStaffId]);
  const target = to === "resolved" ? cfg.tagResolvedId : cfg.tagNeedsStaffId;
  return [...current.filter((t) => !ours.has(t)), target];
}
