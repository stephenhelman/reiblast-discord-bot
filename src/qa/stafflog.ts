import { createLogger, type Logger } from "../logger.js";

/**
 * One line per escalation in the staff log channel: a reason code and links, never message content. Links are wrapped
 * in <> so Discord doesn't unfurl them. Sending never throws and never blocks the caller.
 */
export function createStaffLog(opts: { write: (text: string) => Promise<void>; logger?: Logger }) {
  const log = opts.logger ?? createLogger("staff-log");
  const line = (text: string) => {
    Promise.resolve()
      .then(() => opts.write(text))
      .catch((err: unknown) => log.error("staff log line failed", { error: err instanceof Error ? err.name : "unknown" }));
  };
  const link = (url: string) => `<${url}>`;

  return {
    needsStaff: (reason: string, postUrl: string) => line(`📣 Needs Staff · ${reason} · ${link(postUrl)}`),
    privateThread: (reason: string, postUrl: string, threadUrl: string) =>
      line(`🔒 Private thread · ${reason} · ${link(postUrl)} → ${link(threadUrl)}`),
    movedToPrivate: (postUrl: string, threadUrl: string) => line(`🔒 Moved to private by staff · ${link(postUrl)} → ${link(threadUrl)}`),
    closed: (threadUrl: string) => line(`✅ Private thread closed · ${link(threadUrl)}`),
  };
}

export type StaffLog = ReturnType<typeof createStaffLog>;
