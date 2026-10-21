/** Types for the bot → server verify endpoints. See wholesaleos docs/discord-bot-contract.md. */

export type Identifier = { kind: "email"; value: string } | { kind: "locationId"; value: string };

/** Errors the bot treats as bugs/config problems (contract rule 9) plus the generic server/transport failure. */
export type ErrorReason =
  | "auth_missing"
  | "auth_failed"
  | "server_misconfigured"
  | "bad_json"
  | "bad_request"
  | "internal_error";

export type StartRefusal = "already_linked" | "not_eligible" | "rate_limited" | "delivery_failed";
export type ConfirmRefusal =
  | "already_linked"
  | "not_eligible"
  | "rate_limited"
  | "code_expired"
  | "code_locked"
  | "invalid_code";

export type StartOutcome =
  | { result: "code_sent"; reason: "code_sent"; phoneLast4: string }
  | { result: "linked"; reason: "linked" }
  | { result: "refused"; reason: StartRefusal }
  | { result: "error"; reason: ErrorReason };

export type ConfirmOutcome =
  | { result: "linked"; reason: "linked" }
  | { result: "refused"; reason: Exclude<ConfirmRefusal, "invalid_code"> }
  /** `attemptsRemaining` absent means "no live code — start over" (contract rule 3). */
  | { result: "refused"; reason: "invalid_code"; attemptsRemaining?: number }
  | { result: "error"; reason: ErrorReason };

export type UnlinkOutcome =
  | { result: "unlinked"; reason: "unlinked" }
  | { result: "not_linked"; reason: "not_linked" }
  | { result: "error"; reason: ErrorReason };

export interface ServerClient {
  verifyStart(discordUserId: string, identifier: Identifier): Promise<StartOutcome>;
  verifyConfirm(discordUserId: string, identifier: Identifier, code: string): Promise<ConfirmOutcome>;
  /** Staff unlink: clears the server-side link for this Discord account. No revoke is queued; the bot removes the role. */
  unlink(discordUserId: string): Promise<UnlinkOutcome>;
}
