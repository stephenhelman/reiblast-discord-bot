# REIblast server → Discord bot contract — revoke

The server calls this when a member's access ends (pause function, member removal, later the billing engine). The bot removes the
REIblast role from the linked Discord account. Unconditional and idempotent. (The nightly keep list is a later step and is not in
this document.)

## Request

| | |
|---|---|
| Method / URL | `POST https://bot.reiblast.app/revoke` |
| Auth header | `x-reiblast-bot-secret: <value of DISCORD_BOT_OUTBOUND_SECRET>` (compared timing-safe) |
| Body | JSON object, `Content-Type: application/json` |
| HTTP status | **Always 200.** Read `result` and `reason`; never branch on the status code. |

```json
{ "discordUserId": "123456789012345678" }
```

`discordUserId` is the Discord snowflake as a **string** (15–25 digits). Anything else (missing, non-string, malformed, extra
non-object body) is `bad_request` / `bad_json`.

## Response

`{ "result": "ok" | "error", "reason": "..." }`

| `reason` | `result` | Meaning | Server action |
|---|---|---|---|
| `revoked` | `ok` | Role removed. | Done. |
| `not_in_guild` | `ok` | Member is not in the guild. Nothing to do. | Done. |
| `not_holding_role` | `ok` | Member is in the guild but didn't hold the role. | Done. |
| `auth_missing` | `error` | No secret header. | Config bug. Don't retry; alert. |
| `auth_failed` | `error` | Wrong secret. | Config bug. Don't retry; alert. |
| `bad_json` | `error` | Body is not a JSON object. | Bug. Don't retry. |
| `bad_request` | `error` | `discordUserId` missing or malformed. | Bug. Don't retry. |
| `discord_unavailable` | `error` | Gateway not ready, or a Discord API failure (other than Unknown Member). | **Retry** with backoff. |

All three `ok` reasons are success: mark the revoke delivered.

## Retry expectations

- Treat `result: "ok"` as delivered. Treat `discord_unavailable` and any transport failure (timeout, connection error, non-JSON
  response, 5xx from the host) as retryable; every other `error` reason is permanent for that request.
- Revoke is idempotent, so retrying (or re-sending after an ambiguous failure) is always safe.
- Suggested outbox backoff: 1 min, 5 min, 30 min, 2 h, then alert staff and stop. A bot restart takes seconds, so most failures clear
  on the first retry.
- Use a request timeout of ~10 s. The bot answers in well under a second when the gateway is ready.
- The bot never logs the body beyond reason codes; do not send anything but `discordUserId`.

## Env vars (same name on both sides)

- `DISCORD_BOT_OUTBOUND_SECRET` — server → bot (this endpoint), sent as `x-reiblast-bot-secret`.
- `DISCORD_BOT_INBOUND_SECRET` — bot → server (verify endpoints), sent as `x-reiblast-discord-secret`.

The two must be different values.

## Suggested additions to `lib/billing/reason.ts` (server repo)

`revoked`, `not_in_guild`, `not_holding_role`, `discord_unavailable` (the other codes already exist).
