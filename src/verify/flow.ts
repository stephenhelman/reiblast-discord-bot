import { MessageFlags } from "discord.js";
import type { ActionRowBuilder, ButtonBuilder, EmbedBuilder, ModalBuilder } from "discord.js";
import { createLogger, type Logger } from "../logger.js";
import type { GrantResult } from "../roles/grant.js";
import type { Identifier, ServerClient } from "../server-client/types.js";
import {
  buildAgreeRow,
  buildCodeModal,
  buildEnterCodeRow,
  buildIdentifierModal,
  buildRulesEmbeds,
  type IdentifierKind,
} from "./components.js";
import { IDS } from "./ids.js";
import { createMessages, decideConfirm, decideStart, type Decision, type Reply } from "./messages.js";
import type { SessionStore } from "./session.js";

export interface ReplyPayload {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
}

/** The slice of discord.js interactions the flow touches — keeps handlers easy to mock. */
export interface DeferrableInteraction {
  user: { id: string };
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: ReplyPayload): Promise<unknown>;
}
export interface ModalInteractionLike extends DeferrableInteraction {
  fields: { getTextInputValue(customId: string): string };
}
export interface ButtonInteractionLike {
  user: { id: string };
  showModal(modal: ModalBuilder): Promise<unknown>;
  reply(options: ReplyPayload & { flags: MessageFlags.Ephemeral }): Promise<unknown>;
}

export interface FlowDeps {
  serverClient: Pick<ServerClient, "verifyStart" | "verifyConfirm">;
  sessions: SessionStore;
  /** Rules as embed descriptions (already validated/split at boot). */
  rules: string[];
  supportPhone: string;
  grantRole: (userId: string) => Promise<GrantResult>;
  /** Reason-code-only staff alert; deduped and non-throwing. */
  alert: (code: string) => void;
  logger?: Logger;
}

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCATION_RE = /^[A-Za-z0-9_-]{6,64}$/;
const CODE_RE = /^\d{6}$/;

export function createVerifyFlow(deps: FlowDeps) {
  const { serverClient, sessions } = deps;
  const log = deps.logger ?? createLogger("verify");
  const m = createMessages(deps.supportPhone);

  const replyPayload = (r: Reply): ReplyPayload => ({
    content: r.text,
    ...(r.button === "enter_code" ? { components: [buildEnterCodeRow()] } : {}),
  });
  const rulesPayload = (): ReplyPayload => ({
    content: m.rulesIntro,
    embeds: buildRulesEmbeds(deps.rules),
    components: [buildAgreeRow()],
  });
  const errName = (err: unknown) => (err instanceof Error ? err.name : "unknown");

  /**
   * Defers an ephemeral reply FIRST (the server call + SMS can exceed Discord's 3-second window), runs `work`, then
   * edits the reply exactly once. Never throws out of the handler.
   */
  async function deferred(i: DeferrableInteraction, handler: string, work: () => Promise<ReplyPayload>): Promise<void> {
    try {
      await i.deferReply(EPHEMERAL);
    } catch (err) {
      log.error("defer failed", { handler, error: errName(err) });
      return;
    }
    let payload: ReplyPayload;
    try {
      payload = await work();
    } catch (err) {
      log.error("handler failed", { handler, error: errName(err) });
      payload = { content: m.tryLater };
    }
    try {
      await i.editReply(payload);
    } catch (err) {
      log.error("edit failed", { handler, error: errName(err) });
    }
  }

  /** Applies a Decision to the session and turns it into the reply. */
  function apply(userId: string, d: Decision, identifier?: Identifier): ReplyPayload {
    if (d.type === "linked") {
      sessions.markVerified(userId);
      return rulesPayload();
    }
    if (d.session === "start" && identifier) sessions.begin(userId, identifier);
    else if (d.session === "clear") sessions.clearPending(userId);
    if (d.alert) deps.alert(d.alert);
    return replyPayload(d.reply);
  }

  async function safeButton(handler: string, i: ButtonInteractionLike, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      log.error("handler failed", { handler, error: errName(err) });
      try {
        await i.reply({ content: m.tryLater, ...EPHEMERAL });
      } catch {
        /* interaction expired or already answered */
      }
    }
  }

  return {
    /** Panel button → identifier modal. */
    handlePanelButton: (i: ButtonInteractionLike, kind: IdentifierKind) =>
      safeButton("panel_button", i, () => i.showModal(buildIdentifierModal(kind))),

    /** "Enter Code" → code modal, only while there is a live session from a code_sent. */
    handleEnterCodeButton: (i: ButtonInteractionLike) =>
      safeButton("enter_code_button", i, () =>
        sessions.pending(i.user.id)
          ? i.showModal(buildCodeModal())
          : i.reply({ content: m.startOver, ...EPHEMERAL }),
      ),

    /** Identifier modal submit → verify-start. */
    handleIdentifierModal: (i: ModalInteractionLike, kind: IdentifierKind) =>
      deferred(i, "identifier_modal", async () => {
        const raw = i.fields.getTextInputValue(IDS.fieldIdentifier).trim();
        if (kind === "email" ? !EMAIL_RE.test(raw) : !LOCATION_RE.test(raw)) {
          return { content: kind === "email" ? m.badEmail : m.badLocation };
        }
        const identifier: Identifier = { kind, value: raw };
        const userId = i.user.id;
        sessions.clearPending(userId); // a new attempt invalidates the previous one
        sessions.clearVerified(userId);
        const outcome = await serverClient.verifyStart(userId, identifier);
        log.info("verify-start", { reason: outcome.reason });
        return apply(userId, decideStart(outcome, m), identifier);
      }),

    /** Code modal submit → verify-confirm, only for a session that just got code_sent. */
    handleCodeModal: (i: ModalInteractionLike) =>
      deferred(i, "code_modal", async () => {
        const userId = i.user.id;
        const identifier = sessions.pending(userId);
        if (!identifier) return { content: m.startOver };
        const code = i.fields.getTextInputValue(IDS.fieldCode).trim();
        if (!CODE_RE.test(code)) return { content: m.badCode, components: [buildEnterCodeRow()] };
        const outcome = await serverClient.verifyConfirm(userId, identifier, code);
        log.info("verify-confirm", { reason: outcome.reason });
        return apply(userId, decideConfirm(outcome, m));
      }),

    /** "I agree" → grant the role, but only if this user just verified. */
    handleAgreeButton: (i: DeferrableInteraction) =>
      deferred(i, "agree_button", async () => {
        const userId = i.user.id;
        if (!sessions.isVerified(userId)) return { content: m.startOver };
        const result = await deps.grantRole(userId);
        if (result.status === "failed") {
          log.error("role grant failed", { reason: result.reason });
          deps.alert(`role_${result.reason}`);
          return { content: m.tryLater }; // verified flag stays so they can retry within the window
        }
        sessions.clearVerified(userId);
        log.info("role grant", { status: result.status });
        return { content: m.granted };
      }),
  };
}

export type VerifyFlow = ReturnType<typeof createVerifyFlow>;
