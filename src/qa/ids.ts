/** Static custom IDs only — never put a thread ID, user ID or text in one. */
export const QA_IDS = {
  solved: "qa:solved",
  help: "qa:help",
} as const;

export function isAnswerButton(customId: string): boolean {
  return customId === QA_IDS.solved || customId === QA_IDS.help;
}
