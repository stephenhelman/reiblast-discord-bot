/** KB validation report, used by `npm run kb:check` (cli.ts). Returns the process exit code. */
import { DEFAULT_KB_DIR, KbError, loadKb } from "./load.js";

export interface CheckIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export function runKbCheck(dir: string = DEFAULT_KB_DIR, io: CheckIo = { out: console.log, err: console.error }): number {
  try {
    const kb = loadKb(dir);
    io.out(`kb ok: ${kb.entries.length} entries, hash ${kb.hash}, ${kb.block.length} chars`);
    for (const [file, n] of Object.entries(kb.counts)) io.out(`  ${file}: ${n}`);
    return 0;
  } catch (err) {
    if (!(err instanceof KbError)) throw err;
    io.err(`kb check failed: ${err.issues.length} problem(s)`);
    for (const i of err.issues) io.err(`  ${i.where}: ${i.message}`);
    return 1;
  }
}
