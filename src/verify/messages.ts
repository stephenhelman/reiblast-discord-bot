import type { ConfirmOutcome, StartOutcome } from "../server-client/types.js";

/** What to show the user. `button` adds the Enter Code button under the text. */
export interface Reply {
  text: string;
  button?: "enter_code";
}

/**
 * What the flow should do with the session after a server answer:
 *  start = remember the identifier (code_sent), keep = leave it, clear = drop it.
 */
export type Decision =
  | { type: "linked" }
  | { type: "reply"; reply: Reply; session: "start" | "keep" | "clear"; alert?: string };

export interface Messages {
  /** The ONE refusal message. not_eligible, already_linked, rate_limited and delivery_failed all use it. */
  readonly refusal: string;
  readonly tryLater: string;
  readonly startOver: string;
  readonly codeExpired: string;
  readonly codeLocked: string;
  readonly badEmail: string;
  readonly badLocation: string;
  readonly badCode: string;
  readonly rulesIntro: string;
  readonly granted: string;
}

export function createMessages(supportPhone: string): Messages {
  return Object.freeze({
    refusal:
      "We couldn't verify you automatically. Double-check what you entered and try again, or text the REIblast " +
      `support number (${supportPhone}) and we'll sort it out.`,
    tryLater: "Something went wrong on our end. Please try again in a few minutes.",
    startOver: "That session has expired. Press one of the Verify buttons to start over.",
    codeExpired: "That code has expired. Press one of the Verify buttons to get a new one.",
    codeLocked: "Too many incorrect attempts. Press one of the Verify buttons to start over and get a new code.",
    badEmail: "That doesn't look like an email address. Please try again with the email you signed up with.",
    badLocation: "That doesn't look like a location ID. Please check it and try again.",
    badCode: "Please enter the 6-digit code from the text message.",
    rulesIntro: "You're verified. Please read the community rules below, then click **I agree** to get access.",
    granted: "You're in! The REIblast channels are now unlocked.",
  });
}

/** Errors the contract calls bugs/config problems (rule 9): alert staff, show the user "try later". */
const ALERT_REASONS = new Set(["auth_missing", "auth_failed", "server_misconfigured", "bad_json", "bad_request"]);

type ReplyDecision = Extract<Decision, { type: "reply" }>;

const tryLater = (m: Messages, reason: string): ReplyDecision => ({
  type: "reply",
  reply: { text: m.tryLater },
  session: "keep",
  ...(ALERT_REASONS.has(reason) ? { alert: reason } : {}),
});

export function decideStart(outcome: StartOutcome, m: Messages): Decision {
  switch (outcome.result) {
    case "code_sent":
      return {
        type: "reply",
        reply: {
          text: `We sent a code to the phone ending in ${outcome.phoneLast4}. Enter it within 10 minutes.`,
          button: "enter_code",
        },
        session: "start",
      };
    case "linked":
      return { type: "linked" };
    case "refused":
      return { type: "reply", reply: { text: m.refusal }, session: "clear" };
    case "error":
      return { ...tryLater(m, outcome.reason), session: "clear" };
  }
}

export function decideConfirm(outcome: ConfirmOutcome, m: Messages): Decision {
  switch (outcome.result) {
    case "linked":
      return { type: "linked" };
    case "error":
      return tryLater(m, outcome.reason);
    case "refused":
      switch (outcome.reason) {
        case "invalid_code":
          if (outcome.attemptsRemaining === undefined) {
            // No live code for this member (contract rule 3): treat like code_expired — start over.
            return { type: "reply", reply: { text: m.startOver }, session: "clear" };
          }
          return {
            type: "reply",
            reply: {
              text: `Incorrect code — ${outcome.attemptsRemaining} ${outcome.attemptsRemaining === 1 ? "attempt" : "attempts"} left.`,
              button: "enter_code",
            },
            session: "keep",
          };
        case "code_expired":
          return { type: "reply", reply: { text: m.codeExpired }, session: "clear" };
        case "code_locked":
          return { type: "reply", reply: { text: m.codeLocked }, session: "clear" };
        case "already_linked":
        case "not_eligible":
        case "rate_limited":
          return { type: "reply", reply: { text: m.refusal }, session: "clear" };
      }
  }
}
