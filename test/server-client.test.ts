import { describe, expect, it, vi } from "vitest";
import { createServerClient } from "../src/server-client/client.js";
import type { Logger } from "../src/logger.js";

const SECRET = "test-secret-value";
const EMAIL = "member@example.com";
const DISCORD_ID = "123456789012345678";
const email = { kind: "email", value: EMAIL } as const;
const loc = { kind: "locationId", value: "loc_abc123" } as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setup(fetchImpl: (...a: Parameters<typeof fetch>) => Promise<Response>, timeoutMs?: number) {
  const fetchMock = vi.fn(fetchImpl);
  const lines: string[] = [];
  const push = (m: string, f?: Record<string, unknown>) => lines.push(`${m} ${JSON.stringify(f ?? {})}`);
  const logger: Logger = { debug: push, info: push, warn: push, error: push };
  const client = createServerClient({
    baseUrl: "https://app.example.com",
    secret: SECRET,
    fetch: fetchMock as unknown as typeof fetch,
    logger,
    timeoutMs,
  });
  return { client, fetchMock, lines };
}
const respond = (body: unknown, status = 200) => setup(async () => jsonResponse(body, status));

describe("request shape", () => {
  it("verifyStart posts email with the secret header", async () => {
    const { client, fetchMock } = respond({ result: "linked", reason: "linked" });
    await client.verifyStart(DISCORD_ID, email);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://app.example.com/api/discord/verify/start");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["x-reiblast-discord-secret"]).toBe(SECRET);
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ discordUserId: DISCORD_ID, email: EMAIL });
  });

  it("verifyStart sends exactly one identifier (locationId)", async () => {
    const { client, fetchMock } = respond({ result: "linked", reason: "linked" });
    await client.verifyStart(DISCORD_ID, loc);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({
      discordUserId: DISCORD_ID,
      locationId: "loc_abc123",
    });
  });

  it("verifyConfirm posts the same identifier plus the code", async () => {
    const { client, fetchMock } = respond({ result: "linked", reason: "linked" });
    await client.verifyConfirm(DISCORD_ID, email, "123456");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://app.example.com/api/discord/verify/confirm");
    expect(JSON.parse(init?.body as string)).toEqual({ discordUserId: DISCORD_ID, email: EMAIL, code: "123456" });
  });

  it("does not follow redirects", async () => {
    const { client, fetchMock } = respond({ result: "linked", reason: "linked" });
    await client.verifyStart(DISCORD_ID, email);
    expect(fetchMock.mock.calls[0]![1]?.redirect).toBe("error");
  });
});

describe("Vercel protection bypass header", () => {
  const BYPASS = "vercel-bypass-secret-value";

  function withBypass(bypass: string | undefined) {
    const fetchMock = vi.fn(async (..._a: Parameters<typeof fetch>) => jsonResponse({ result: "linked", reason: "linked" }));
    const lines: string[] = [];
    const push = (m: string, f?: Record<string, unknown>) => lines.push(`${m} ${JSON.stringify(f ?? {})}`);
    const client = createServerClient({
      baseUrl: "https://app.example.com",
      secret: SECRET,
      vercelBypassSecret: bypass,
      fetch: fetchMock as unknown as typeof fetch,
      logger: { debug: push, info: push, warn: push, error: push },
    });
    return { client, fetchMock, lines };
  }
  const headersOf = (f: ReturnType<typeof withBypass>["fetchMock"]) => f.mock.calls[0]![1]?.headers as Record<string, string>;

  it("is sent on verify-start and verify-confirm when configured", async () => {
    const { client, fetchMock } = withBypass(BYPASS);
    await client.verifyStart(DISCORD_ID, email);
    await client.verifyConfirm(DISCORD_ID, email, "123456");
    for (const call of fetchMock.mock.calls) {
      const h = call[1]?.headers as Record<string, string>;
      expect(h["x-vercel-protection-bypass"]).toBe(BYPASS);
      expect(h["x-reiblast-discord-secret"]).toBe(SECRET); // the real secret is still sent
    }
  });

  it.each([[undefined], [""]])("is not sent when unset (%j)", async (value) => {
    const { client, fetchMock } = withBypass(value);
    await client.verifyStart(DISCORD_ID, email);
    expect(Object.keys(headersOf(fetchMock)).map((k) => k.toLowerCase())).not.toContain("x-vercel-protection-bypass");
  });

  it("is never logged", async () => {
    const ok = withBypass(BYPASS);
    await ok.client.verifyStart(DISCORD_ID, email);
    const failing = createServerClient({
      baseUrl: "https://app.example.com",
      secret: SECRET,
      vercelBypassSecret: BYPASS,
      fetch: (async () => {
        throw new Error(`connect failed ${BYPASS}`);
      }) as unknown as typeof fetch,
      logger: { debug: (m) => ok.lines.push(m), info: (m) => ok.lines.push(m), warn: (m) => ok.lines.push(m), error: (m) => ok.lines.push(m) },
    });
    await failing.verifyStart(DISCORD_ID, email);
    expect(ok.lines.join("\n")).not.toContain(BYPASS);
  });
});

describe("verifyStart reason codes", () => {
  it("code_sent carries phoneLast4", async () => {
    const { client } = respond({ result: "code_sent", reason: "code_sent", phoneLast4: "1234" });
    expect(await client.verifyStart(DISCORD_ID, email)).toEqual({
      result: "code_sent",
      reason: "code_sent",
      phoneLast4: "1234",
    });
  });

  it("linked", async () => {
    const { client } = respond({ result: "linked", reason: "linked" });
    expect(await client.verifyStart(DISCORD_ID, email)).toEqual({ result: "linked", reason: "linked" });
  });

  it.each(["already_linked", "not_eligible", "rate_limited", "delivery_failed"])("refused: %s", async (reason) => {
    const { client } = respond({ result: "refused", reason });
    expect(await client.verifyStart(DISCORD_ID, email)).toEqual({ result: "refused", reason });
  });

  it.each(["auth_missing", "auth_failed", "server_misconfigured", "bad_json", "bad_request", "internal_error"])(
    "error: %s",
    async (reason) => {
      const { client } = respond({ result: "error", reason });
      expect(await client.verifyStart(DISCORD_ID, email)).toEqual({ result: "error", reason });
    },
  );

  it("rejects reasons that don't belong to start (confirm-only codes)", async () => {
    for (const reason of ["invalid_code", "code_expired", "code_locked"]) {
      const { client } = respond({ result: "refused", reason });
      expect(await client.verifyStart(DISCORD_ID, email)).toEqual({ result: "error", reason: "internal_error" });
    }
  });

  it("rejects a malformed phoneLast4", async () => {
    for (const phoneLast4 of ["12", "12345", "abcd", 1234, undefined]) {
      const { client } = respond({ result: "code_sent", reason: "code_sent", phoneLast4 });
      expect(await client.verifyStart(DISCORD_ID, email)).toEqual({ result: "error", reason: "internal_error" });
    }
  });
});

describe("verifyConfirm reason codes", () => {
  it("linked", async () => {
    const { client } = respond({ result: "linked", reason: "linked" });
    expect(await client.verifyConfirm(DISCORD_ID, email, "123456")).toEqual({ result: "linked", reason: "linked" });
  });

  it.each(["already_linked", "not_eligible", "rate_limited", "code_expired", "code_locked"])(
    "refused: %s",
    async (reason) => {
      const { client } = respond({ result: "refused", reason });
      expect(await client.verifyConfirm(DISCORD_ID, email, "123456")).toEqual({ result: "refused", reason });
    },
  );

  it("invalid_code with attemptsRemaining", async () => {
    const { client } = respond({ result: "refused", reason: "invalid_code", attemptsRemaining: 2 });
    expect(await client.verifyConfirm(DISCORD_ID, email, "123456")).toEqual({
      result: "refused",
      reason: "invalid_code",
      attemptsRemaining: 2,
    });
  });

  it("invalid_code without attemptsRemaining stays absent", async () => {
    const { client } = respond({ result: "refused", reason: "invalid_code" });
    const out = await client.verifyConfirm(DISCORD_ID, email, "123456");
    expect(out).toEqual({ result: "refused", reason: "invalid_code" });
    expect("attemptsRemaining" in out).toBe(false);
  });

  it.each(["auth_missing", "auth_failed", "server_misconfigured", "bad_json", "bad_request", "internal_error"])(
    "error: %s",
    async (reason) => {
      const { client } = respond({ result: "error", reason });
      expect(await client.verifyConfirm(DISCORD_ID, email, "123456")).toEqual({ result: "error", reason });
    },
  );

  it("rejects start-only outcomes (code_sent, delivery_failed)", async () => {
    for (const body of [
      { result: "code_sent", reason: "code_sent", phoneLast4: "1234" },
      { result: "refused", reason: "delivery_failed" },
    ]) {
      const { client } = respond(body);
      expect(await client.verifyConfirm(DISCORD_ID, email, "123456")).toEqual({
        result: "error",
        reason: "internal_error",
      });
    }
  });

  it("rejects a negative or non-integer attemptsRemaining", async () => {
    for (const attemptsRemaining of [-1, 1.5, "2"]) {
      const { client } = respond({ result: "refused", reason: "invalid_code", attemptsRemaining });
      expect(await client.verifyConfirm(DISCORD_ID, email, "123456")).toEqual({
        result: "error",
        reason: "internal_error",
      });
    }
  });
});

describe("failures map to internal_error", () => {
  const INTERNAL = { result: "error", reason: "internal_error" };

  it("network error", async () => {
    const { client } = setup(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await client.verifyStart(DISCORD_ID, email)).toEqual(INTERNAL);
    expect(await client.verifyConfirm(DISCORD_ID, email, "123456")).toEqual(INTERNAL);
  });

  it("timeout (real AbortSignal, short timeout)", async () => {
    const { client, lines } = setup(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
      20,
    );
    expect(await client.verifyStart(DISCORD_ID, email)).toEqual(INTERNAL);
    expect(lines.join("\n")).toContain('"cause":"timeout"');
  });

  it("unparseable body", async () => {
    const { client } = setup(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    expect(await client.verifyStart(DISCORD_ID, email)).toEqual(INTERNAL);
  });

  it("unknown result/reason, non-object bodies, empty body", async () => {
    for (const body of [
      { result: "refused", reason: "something_new" },
      { result: "maybe", reason: "linked" },
      { reason: "linked" },
      [],
      null,
      "linked",
    ]) {
      const { client } = respond(body);
      expect(await client.verifyStart(DISCORD_ID, email)).toEqual(INTERNAL);
    }
    const { client } = setup(async () => new Response("", { status: 200 }));
    expect(await client.verifyStart(DISCORD_ID, email)).toEqual(INTERNAL);
  });

  it("never branches on HTTP status: a valid body is honored on any status", async () => {
    const { client } = respond({ result: "refused", reason: "not_eligible" }, 500);
    expect(await client.verifyStart(DISCORD_ID, email)).toEqual({ result: "refused", reason: "not_eligible" });
  });

  it("a 200 with an error-shaped garbage body is still internal_error", async () => {
    const { client } = respond({ error: "boom" }, 200);
    expect(await client.verifyStart(DISCORD_ID, email)).toEqual(INTERNAL);
  });
});

describe("logging", () => {
  it("logs endpoint + reason only — no email, code, phone digits, secret or user id", async () => {
    const a = setup(async () => jsonResponse({ result: "code_sent", reason: "code_sent", phoneLast4: "4821" }));
    await a.client.verifyStart(DISCORD_ID, email);
    const b = setup(async () => jsonResponse({ result: "refused", reason: "invalid_code", attemptsRemaining: 2 }));
    await b.client.verifyConfirm(DISCORD_ID, email, "987654");
    const c = setup(async () => {
      throw new Error(`connect failed for ${EMAIL} ${SECRET}`);
    });
    await c.client.verifyStart(DISCORD_ID, email);

    const all = [...a.lines, ...b.lines, ...c.lines].join("\n");
    for (const forbidden of [EMAIL, "987654", "4821", SECRET, DISCORD_ID]) {
      expect(all).not.toContain(forbidden);
    }
    expect(a.lines[0]).toContain('"endpoint":"verify-start"');
    expect(a.lines[0]).toContain('"reason":"code_sent"');
    expect(b.lines[0]).toContain('"endpoint":"verify-confirm"');
  });
});
