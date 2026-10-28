import { describe, expect, it, vi } from "vitest";
import { createServerClient } from "../src/server-client/client.js";
import { buildFounderPanel, createFounderHandlers, FOUNDER_CLAIM_ID } from "../src/founder/claim.js";
import type { FounderLinkOutcome } from "../src/server-client/types.js";

const URL_SECRET = "https://app.example.com/claim?token=SECRET_TOKEN";
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

function client(fetchImpl: () => Promise<Response>) {
  return createServerClient({
    baseUrl: "https://app.example.com",
    secret: "s3cret",
    fetch: vi.fn(fetchImpl) as unknown as typeof fetch,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
}

describe("founderLink client", () => {
  it("posts discordUserId to /api/discord/founder-link with the secret header", async () => {
    const f = vi.fn(async () => json({ result: "ok", reason: "link_issued", url: URL_SECRET, message: "hi" }));
    const c = createServerClient({ baseUrl: "https://app.example.com", secret: "s3cret", fetch: f as unknown as typeof fetch });
    const out = await c.founderLink("123");
    expect(out).toMatchObject({ result: "ok", url: URL_SECRET });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.example.com/api/discord/founder-link");
    expect((init.headers as Record<string, string>)["x-reiblast-discord-secret"]).toBe("s3cret");
    expect(JSON.parse(init.body as string)).toEqual({ discordUserId: "123" });
  });
  it("parses not_verified and rate_limited; unexpected shapes become error", async () => {
    expect(await client(async () => json({ result: "not_verified", reason: "x", message: "verify first" })).founderLink("1")).toMatchObject({ result: "not_verified", message: "verify first" });
    expect(await client(async () => json({ result: "refused", reason: "rate_limited" })).founderLink("1")).toEqual({ result: "refused", reason: "rate_limited" });
    expect(await client(async () => json({ result: "ok", reason: "link_issued", message: "no url" })).founderLink("1")).toEqual({ result: "error", reason: "internal_error" });
    expect(await client(async () => json({ weird: true })).founderLink("1")).toEqual({ result: "error", reason: "internal_error" });
    expect(await client(async () => { throw new Error("net"); }).founderLink("1")).toEqual({ result: "error", reason: "internal_error" });
  });
});

function button(outcome: FounderLinkOutcome | Error) {
  const founderLink = vi.fn(async () => { if (outcome instanceof Error) throw outcome; return outcome; });
  const lines: string[] = [];
  const push = (m: string, f?: unknown) => lines.push(`${m} ${JSON.stringify(f ?? {})}`);
  const h = createFounderHandlers({ serverClient: { founderLink }, logger: { debug: push, info: push, warn: push, error: push } });
  const i = { user: { id: "42" }, deferReply: vi.fn(async () => {}), editReply: vi.fn(async (_o: unknown) => {}) };
  return { run: () => h.claim(i as never), i, founderLink, lines };
}

describe("claim button", () => {
  it("defers ephemerally, then replies with message + LINK button; never logs the url", async () => {
    const b = button({ result: "ok", reason: "link_issued", url: URL_SECRET, message: "Here you go" });
    await b.run();
    expect(b.i.deferReply).toHaveBeenCalledOnce();
    expect(b.founderLink).toHaveBeenCalledWith("42");
    const arg = b.i.editReply.mock.calls[0]![0] as { content: string; components: { toJSON(): any }[] };
    expect(arg.content).toBe("Here you go");
    const btn = arg.components[0]!.toJSON().components[0];
    expect(btn).toMatchObject({ style: 5, label: "Open your claim page", url: URL_SECRET });
    expect(b.lines.join("\n")).not.toContain("SECRET_TOKEN");
  });
  it("not_verified shows the server message only", async () => {
    const b = button({ result: "not_verified", reason: "x", message: "Verify first" });
    await b.run();
    expect(b.i.editReply).toHaveBeenCalledWith({ content: "Verify first", components: [] });
  });
  it("rate limited and error use the fixed copy", async () => {
    const r = button({ result: "refused", reason: "rate_limited" });
    await r.run();
    expect(r.i.editReply).toHaveBeenCalledWith({ content: "You're pressing too fast. Wait a minute and try again.", components: [] });
    const e = button({ result: "error", reason: "auth_failed" });
    await e.run();
    expect(e.i.editReply).toHaveBeenCalledWith({ content: "Something went wrong. Try again in a minute or text support.", components: [] });
    const t = button(new Error("boom"));
    await t.run();
    expect((t.i.editReply.mock.calls[0]![0] as { content: string }).content).toMatch(/Something went wrong/);
  });
});

describe("panel", () => {
  it("matches the spec", () => {
    const p = buildFounderPanel();
    const e = p.embeds[0]!.toJSON();
    expect(e.color).toBe(16107586);
    expect(e.title).toBe("🏆 Founder's Offer: Claim Your REIsite Slot");
    expect(e.footer?.text).toBe("REIsite & REIkit provided by OP Web Studio, a subsidiary of Operation Profit LLC");
    expect(p.components[0]!.toJSON().components[0]).toMatchObject({ style: 1, label: "Claim my spot", custom_id: FOUNDER_CLAIM_ID });
  });
});
