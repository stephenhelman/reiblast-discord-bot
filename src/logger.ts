/**
 * Minimal timestamped logger (same shape as the Kelme worker's log()). Callers pass reason codes and
 * names only — never emails, codes, phone digits, tokens or secret values.
 */
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function threshold(): number {
  const raw = process.env.LOG_LEVEL;
  return raw && raw in ORDER ? ORDER[raw as Level] : ORDER.info;
}

function emit(level: Level, scope: string, message: string, fields?: Record<string, string | number | boolean>): void {
  if (ORDER[level] < threshold()) return;
  const extra = fields
    ? " " + Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" ")
    : "";
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} [${scope}] ${message}${extra}`;
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, f?: Record<string, string | number | boolean>) => emit("debug", scope, m, f),
    info: (m: string, f?: Record<string, string | number | boolean>) => emit("info", scope, m, f),
    warn: (m: string, f?: Record<string, string | number | boolean>) => emit("warn", scope, m, f),
    error: (m: string, f?: Record<string, string | number | boolean>) => emit("error", scope, m, f),
  };
}

export type Logger = ReturnType<typeof createLogger>;
