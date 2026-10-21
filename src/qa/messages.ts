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
  staffOnly: "Only REIblast staff can use this button.",
  memberGone: "I couldn't find that member in the server, so I can't open a private thread for them.",
  alreadyPrivate: "A private thread already exists for this post.",
  /** Fixed escalation template; the role mention is the one ping (allowedMentions limits it to that role). */
  handoff: (roleId: string) => `<@&${roleId}> Thanks for your patience. I'm handing this to the team, and someone will follow up here.`,
  /** Public note in the forum post once it moves to a private thread. No details. */
  privateNote: (threadId: string) => `I've moved this to a private thread so the team can look at your account: <#${threadId}>`,
  /** Last message in a private thread before it is archived and locked. */
  closed: "This thread is now closed. If anything else comes up, please open a new post in the support forum and tag it **Support**.",
} as const;

export const QA_LABELS = {
  solved: "That solved it",
  help: "Still need help",
  movePrivate: "Move to private",
  close: "Close",
} as const;
