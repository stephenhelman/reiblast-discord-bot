import { Events, type Client } from "discord.js";
import { createLogger } from "../logger.js";
import type { VerifyFlow } from "../verify/flow.js";
import type { createSetupHandler } from "../verify/setup.js";
import type { createUnlinkHandler } from "../verify/unlink.js";
import { IDS } from "../verify/ids.js";
import { SETUP_VERIFY, UNLINK } from "./commands.js";

/** Routes interactions by static custom ID. The listener never lets an error escape. */
export function registerInteractionHandlers(
  client: Client,
  deps: { flow: VerifyFlow; setup: ReturnType<typeof createSetupHandler>; unlink: ReturnType<typeof createUnlinkHandler> },
): void {
  const log = createLogger("interactions");
  const { flow, setup, unlink } = deps;

  client.on(Events.InteractionCreate, (i) => {
    const run = async (): Promise<void> => {
      if (i.isChatInputCommand()) {
        if (i.commandName === SETUP_VERIFY) await setup(i);
        else if (i.commandName === UNLINK) await unlink(i);
      } else if (i.isButton()) {
        switch (i.customId) {
          case IDS.buttonEmail:
            return flow.handlePanelButton(i, "email");
          case IDS.buttonLocation:
            return flow.handlePanelButton(i, "locationId");
          case IDS.buttonEnterCode:
            return flow.handleEnterCodeButton(i);
          case IDS.buttonAgree:
            return flow.handleAgreeButton(i);
        }
      } else if (i.isModalSubmit()) {
        switch (i.customId) {
          case IDS.modalEmail:
            return flow.handleIdentifierModal(i, "email");
          case IDS.modalLocation:
            return flow.handleIdentifierModal(i, "locationId");
          case IDS.modalCode:
            return flow.handleCodeModal(i);
        }
      }
    };
    run().catch((err: unknown) => log.error("unhandled interaction error", { error: err instanceof Error ? err.name : "unknown" }));
  });
}
