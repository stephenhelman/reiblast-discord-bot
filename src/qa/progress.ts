/** How many questions the bot may ask in a row before it has to answer or hand off. */
export const MAX_DIAGNOSE = 4;
export const MAX_CLARIFY = 1;

/** Where a thread stands in the current run of consecutive question turns (a run ends at an answer or a handoff). */
export interface QuestionProgress {
  /** Diagnose questions asked so far in the run. */
  diagnoseAsked: number;
  /** A clarifying question has been asked in the run. */
  clarifyUsed: boolean;
}

export const NO_PROGRESS: QuestionProgress = { diagnoseAsked: 0, clarifyUsed: false };
