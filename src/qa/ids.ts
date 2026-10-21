/** Static custom IDs only — never put a thread ID, user ID or text in one. */
export const QA_IDS = {
  solved: "qa:solved",
  help: "qa:help",
  toPrivate: "qa:to-private",
  close: "qa:close",
} as const;

/** Buttons under a forum answer (poster or staff). */
export function isAnswerButton(customId: string): boolean {
  return customId === QA_IDS.solved || customId === QA_IDS.help;
}

/** Staff-only buttons: "Move to private" on a Needs Staff post, "Close" in a private thread. */
export function isStaffButton(customId: string): boolean {
  return customId === QA_IDS.toPrivate || customId === QA_IDS.close;
}
