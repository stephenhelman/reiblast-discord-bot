/** Fixed bot-authored text. Model output is never mixed into these, and none of it contains a mention. */
export const QA_TEXT = {
  /** Chat / Wins, when the bot can't answer (not covered, account-specific, or the model failed). */
  chatPointer: "I can't answer that one here. Please post it in the support forum and tag it **Support** so the team can help.",
  /** Forum, once per rate-limit window. */
  rateLimited: "You're sending questions faster than I can keep up with. Please wait a few minutes and try again.",
  solvedAck: "Glad that helped! I've marked this as resolved.",
  notAllowed: "Only the person who asked, or REIblast staff, can use these buttons.",
  alreadyHandled: "This one is already being handled.",
  genericError: "Something went wrong on our end. Please try again in a moment.",
} as const;

export const QA_LABELS = {
  solved: "That solved it",
  help: "Still need help",
} as const;
