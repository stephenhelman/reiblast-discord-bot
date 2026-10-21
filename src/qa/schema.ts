import { z } from "zod";

export const OUTCOMES = ["answered", "clarify", "not_covered", "account_specific"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * Sent as output_config.format. A plain JSON schema (not the SDK's zod/v4 helper) because the repo is on zod v3;
 * the response is validated again below, since the schema cannot express everything we rely on.
 */
export const ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: [...OUTCOMES] },
    reply: { type: "string" },
    kbIds: { type: "array", items: { type: "string" } },
  },
  required: ["outcome", "reply", "kbIds"],
  additionalProperties: false,
} as const;

export const modelAnswerSchema = z
  .object({
    outcome: z.enum(OUTCOMES),
    reply: z.string(),
    kbIds: z.array(z.string()),
  })
  .strict();

export type ModelAnswer = z.infer<typeof modelAnswerSchema>;
