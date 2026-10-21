import { MessageFlags } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createSetupHandler, type SetupInteractionLike } from "../src/verify/setup.js";
import type { Logger } from "../src/logger.js";
import { IDS } from "../src/verify/ids.js";
import type { buildPanelMessage } from "../src/verify/components.js";

type PanelMessage = ReturnType<typeof buildPanelMessage>;
type Channel = { send: ReturnType<typeof vi.fn<(o: PanelMessage) => Promise<unknown>>> };
const newChannel = (): Channel => ({ send: vi.fn(async (_o: PanelMessage) => {}) });

const GUILD = "111111111111111111";
const STAFF = "222222222222222222";
const quietLog: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function interaction(over: Partial<SetupInteractionLike> = {}) {
  return {
    guildId: GUILD,
    member: { roles: [STAFF] },
    reply: vi.fn(async () => {}),
    deferReply: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
    ...over,
  } satisfies SetupInteractionLike;
}

function handler(channel: Channel | null) {
  return createSetupHandler({
    guildId: GUILD,
    staffRoleId: STAFF,
    getVerifyChannel: async () => channel,
    logger: quietLog,
  });
}

describe("/setup-verify staff gating", () => {
  it("staff (role id array) posts the panel to the Verify channel and confirms ephemerally", async () => {
    const channel = newChannel();
    const i = interaction();
    await handler(channel)(i);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(channel.send).toHaveBeenCalledTimes(1);
    const sent = channel.send.mock.calls[0]![0];
    const ids = sent.components[0]!.toJSON().components.map((c) => ("custom_id" in c ? c.custom_id : ""));
    expect(ids).toEqual([IDS.buttonEmail, IDS.buttonLocation]);
    expect(i.editReply).toHaveBeenCalledWith({ content: "Verify panel posted." });
  });

  it("staff via a GuildMember-style role cache works too", async () => {
    const channel = newChannel();
    const i = interaction({ member: { roles: { cache: { has: (id: string) => id === STAFF } } } });
    await handler(channel)(i);
    expect(channel.send).toHaveBeenCalled();
  });

  it("a non-staff member gets an ephemeral denial and nothing is posted", async () => {
    const channel = newChannel();
    const i = interaction({ member: { roles: ["999999999999999999"] } });
    await handler(channel)(i);
    expect(i.reply).toHaveBeenCalledWith({ content: expect.stringContaining("staff"), flags: MessageFlags.Ephemeral });
    expect(channel.send).not.toHaveBeenCalled();
    expect(i.deferReply).not.toHaveBeenCalled();
  });

  it("no member (DM) or wrong guild is denied", async () => {
    for (const over of [{ member: null }, { guildId: "333333333333333333" }, { guildId: null }]) {
      const channel = newChannel();
      const i = interaction(over);
      await handler(channel)(i);
      expect(i.reply).toHaveBeenCalledTimes(1);
      expect(channel.send).not.toHaveBeenCalled();
    }
  });

  it("a missing Verify channel is reported, not thrown", async () => {
    const i = interaction();
    await expect(handler(null)(i)).resolves.toBeUndefined();
    expect(i.editReply).toHaveBeenCalledWith({ content: expect.stringContaining("Verify channel") });
  });

  it("a send failure is reported, not thrown", async () => {
    const channel: Channel = { send: vi.fn(async (_o: PanelMessage) => { throw new Error("Missing Permissions"); }) };
    const i = interaction();
    await expect(handler(channel)(i)).resolves.toBeUndefined();
    expect(i.editReply).toHaveBeenLastCalledWith({ content: expect.stringContaining("couldn't post") });
  });
});
