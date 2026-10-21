/** `npm run kb:check` — validates kb/*.md and prints counts. Exit 1 on any problem. */
import { runKbCheck } from "./check.js";

process.exit(runKbCheck());
