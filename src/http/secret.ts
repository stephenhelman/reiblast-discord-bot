import { createHash, timingSafeEqual } from "node:crypto";

/** Timing-safe comparison. Hashing first gives equal-length buffers, so length differences don't leak either. */
export function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
