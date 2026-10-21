# SETUP — manual checklist

Work top to bottom. Steps 1–5 get the bot working against your private test server. Step 6 puts it on Railway. Step 7 is the
later swap to the partner's server.

Nothing here puts a secret in a file that gets committed. `.env` is git-ignored; Railway and Vercel hold the real values.

> **Never run two copies of the bot with the same token at once** (e.g. `npm run dev` on your laptop while Railway is running).
> Both would answer every button click and one of them would fail with "interaction already acknowledged". Stop the local one
> before deploying to Railway, or use a second Discord application for local dev.

---

## 0. Before you start

- Node 22 locally (`node -v`), repo cloned, `npm install` done.
- Turn on Developer Mode in Discord: **User Settings → Advanced → Developer Mode**. You need it to right-click → **Copy ID**
  on servers, channels and roles.
- Generate the two shared secrets (any 32+ random chars). They must be **different** from each other:
  ```bash
  openssl rand -hex 32   # → DISCORD_BOT_INBOUND_SECRET  (bot → server)
  openssl rand -hex 32   # → DISCORD_BOT_OUTBOUND_SECRET (server → bot)
  ```
  Keep them in a password manager. The bot refuses to boot if they are equal.

---

## 1. Discord Developer Portal

<https://discord.com/developers/applications>

1. **New Application** → name it (e.g. "REIblast"). From **General Information**, copy the **Application ID** →
   `DISCORD_APPLICATION_ID`.
2. **Bot** tab:
   - **Reset Token** → copy it once → `DISCORD_BOT_TOKEN`. (If it ever leaks, reset it here and update Railway.)
   - **Privileged Gateway Intents:**
     - **Server Members Intent: ON** (required — the bot looks up members to grant/revoke the role).
     - **Message Content Intent: ON** (required — the Q&A feature reads members' questions. Without it Discord refuses the
       login with "Used disallowed intents", so the bot won't start.)
     - Presence Intent: OFF.
3. **Public Bot** toggle — see step 7. For the test server you can leave it as is; for the partner's server it matters.

---

## 2. Your personal test server

Create a fresh server you own, then:

**Roles** (Server Settings → Roles)
- `REIblast` — the role the bot grants. Give it no special permissions. Copy its ID → `DISCORD_REIBLAST_ROLE_ID`.
- `REIblast Staff` — your staff role. Assign it to yourself. Copy its ID → `DISCORD_STAFF_ROLE_ID`.

**Channels**
- `#verify` — copy ID → `DISCORD_VERIFY_CHANNEL_ID`.
- `#staff-log` — copy ID → `DISCORD_STAFF_LOG_CHANNEL_ID`.
- A category `REIblast` with at least a couple of channels (e.g. `#chat`, `#rules`) so you can see the role work.
- Copy the **server ID** (right-click the server icon) → `DISCORD_GUILD_ID`.

**Permissions** (per the brief: deny `@everyone` at the category, grant the role, let channels inherit; Verify is the exception)

| Where | `@everyone` | `REIblast` | `REIblast Staff` | Bot |
|---|---|---|---|---|
| Category `REIblast` | View Channel ✗ | View Channel ✓ (+ Send Messages where members chat) | — | — |
| `#verify` (outside the category, or with its own override) | View Channel ✓, Read Message History ✓, **Send Messages ✗** | — | — | View Channel ✓, Send Messages ✓, Embed Links ✓ |
| `#staff-log` | View Channel ✗ | ✗ | View Channel ✓, Send Messages ✓ | **View Channel ✓, Send Messages ✓** (add an explicit override for the bot — a private channel hides it from the bot too) |

`@everyone` needs no Send permission in `#verify`: the Verify buttons are interactions, not messages.

---

## 3. Invite the bot, and put its role ABOVE the REIblast role

1. Build the invite URL (replace `APP_ID`):
   ```
   https://discord.com/oauth2/authorize?client_id=APP_ID&scope=bot%20applications.commands&permissions=361045904384
   ```
   - Scopes: `bot` and `applications.commands` (the second is required for the slash command).
   - `361045904384` = **Manage Roles** (grant/remove the REIblast role) + **View Channel** + **Send Messages** + **Embed Links** +
     **Read Message History** + **Manage Threads** (change a forum post's tags; archive and lock private threads) +
     **Create Private Threads** + **Send Messages in Threads** (answers in forum posts and in private threads) +
     **Mention Everyone** (the bot must hold this to ping the support role if that role isn't set mentionable; the bot's
     messages are otherwise locked to `allowedMentions: { parse: [] }`, so it can never ping @everyone or anyone else).
   - Already invited the bot earlier (it only had Manage Roles + the three basics)? Open this new URL again to update its
     permissions, or tick the same permissions on the bot's role by hand.
2. Open it, pick your test server, authorize.
3. **Server Settings → Roles:** the bot got its own role (named after the bot). **Drag it above the `REIblast` role.** Discord
   only lets a bot manage roles *below* its own highest role. If it's below, every grant fails with Missing Permissions and
   staff get a `role_missing_permissions` alert.
4. Members whose highest role is above the bot's (you as owner, admins) can never be modified by the bot. That's expected; test
   with a non-admin account if you need to see a real revoke (see step 5).

---

## 3b. Support Q&A: forum, Support channel, roles

The bot answers questions from the knowledge base in `kb/` (see [docs/qa-live-test.md](docs/qa-live-test.md) for the manual test
checklist). It needs a support **forum**, a locked **Support** channel for private threads, and a **support role**.

**Support forum**
1. Server Settings → **Enable Community** if it isn't already (forum channels need it). Create a **Forum** channel.
2. Add three tags: **Support**, **Resolved**, **Needs Staff**. (You may make Resolved and Needs Staff moderator-only; the bot has
   Manage Threads and can still apply them.)
3. Copy the forum's channel ID → `DISCORD_SUPPORT_FORUM_ID`, put your bot token in `.env` too, then print the tag IDs:
   ```bash
   npm run list-forum-tags     # prints  <tag name>  <tag ID>  per line, then exits
   ```
   → `DISCORD_TAG_SUPPORT_ID`, `DISCORD_TAG_RESOLVED_ID`, `DISCORD_TAG_NEEDS_STAFF_ID`. (This is the only place IDs are ever printed.)
4. Forum permissions: members — View Channel, Create Posts, Send Messages in Posts, Read Message History. The bot — View Channel,
   Send Messages in Posts, Read Message History, **Manage Threads**.

**Support channel** (the private-thread parent; a plain text channel — keep your pinned how-to video and instructions in it)
- Copy its ID → `DISCORD_SUPPORT_CHANNEL_ID`.
- Members (the REIblast role): **View Channel ✓, Read Message History ✓, Send Messages in Threads ✓**, and **Send Messages ✗,
  Create Public Threads ✗, Create Private Threads ✗**. They can view the channel and reply inside threads they're added to, but
  can't post top-level or start threads.
- Support role: **View Channel ✓, Send Messages in Threads ✓, Manage Threads ✓**. Discord only shows private threads to people who
  were added **or** hold Manage Threads, so this is what lets staff see and close every private thread.
- Bot: **View Channel, Create Private Threads, Send Messages in Threads, Manage Threads, Read Message History**. It never posts
  top-level here and never touches the pins; it only creates threads under it.

**Support role**
- Copy its ID → `DISCORD_SUPPORT_ROLE_ID`. It is pinged on escalations (and in each private thread's first message). The ping only
  works if the bot holds **Mention Everyone** (included in the invite integer above) or the role is mentionable.
- Members of the **staff role** or the **support role** can use the staff buttons (Move to private, Close).

**Check it**
1. `npm run kb:check` → `kb ok: 250 entries …`.
2. Start the bot. The log shows `setup check passed`, or `setup check found problems problems=…` with static codes (and a
   `qa_misconfigured` alert in the staff log): `tag_*_not_in_forum` (wrong tag ID), `forum_missing_*` / `support_channel_missing_*`
   (a permission above), `support_role_not_pingable`, `*_not_found` / `*_wrong_type` (wrong channel or role ID).
3. Optional but recommended on the **test server only**: `npm run verify-private-threads` (creates one private thread under the
   Support channel, checks Discord's behavior, deletes it). After any KB or rules edit run `npm run eval:qa` (see the end of this file).
4. Walk through [docs/qa-live-test.md](docs/qa-live-test.md).

---

## 4. Server side (wholesaleos)

This is in the **wholesaleos** repo / Vercel project, branch `discord/link-model`. The verify endpoints already exist there.

### 4a. Database
The branch needs a database that has the `DiscordLink` and `DiscordVerifyAttempt` tables — the Neon **discord-dev** branch. Make
sure the schema has been pushed to it before testing.

> ⚠️ **The dev DB holds real member phone numbers, and the verify flow sends real SMS.** Test with **your own** account only
> (step 5).

### 4b. Vercel Preview environment variables, scoped to the branch
Vercel project → **Settings → Environment Variables → Add**. For each: Environments = **Preview** only, then choose
**a specific Git branch** = `discord/link-model`.

| Name | Value |
|---|---|
| `DATABASE_URL` | connection string of the **discord-dev** Neon branch |
| `PIPELINE_DATABASE_URL` | same discord-dev connection string (see note) |
| `DISCORD_BOT_INBOUND_SECRET` | the bot → server secret from step 0 |
| `GHL_HQ_API_KEY` | needed for the phone lookup (already used elsewhere in the app) |
| `GHL_OTP_WEBHOOK_URL_ONBOARDING` | needed to send the SMS code (used by `lib/otp.ts`) |

Notes:
- **Why both DB vars:** `getBillingDb()` (used by the Discord routes) prefers `PIPELINE_DATABASE_URL` in Preview, and refuses to
  run if the database it would use is the production host. If an existing Preview-scoped `PIPELINE_DATABASE_URL` applies to
  *all* preview branches, it would send verify traffic to the pipeline database instead of discord-dev. A branch-specific value
  overrides it. Check **Settings → Environment Variables** for what is already there before adding.
- If `GHL_HQ_API_KEY` / `GHL_OTP_WEBHOOK_URL_ONBOARDING` are missing for this branch, verify-start returns `delivery_failed`,
  which the bot shows as the generic "We couldn't verify you automatically" message — easy to mistake for a bug in the bot.
- `DISCORD_BOT_OUTBOUND_SECRET` is **not** needed on the server yet (no revoke hook there until you build it).
- Env var changes only apply to **new** deployments. After editing, redeploy the branch (push a commit, or Deployments →
  Redeploy).

### 4c. Preview deployment protection (only if previews are protected)
If a preview URL shows a Vercel login page in a private window, the bot's calls would get that HTML instead of JSON (the bot
treats it as `internal_error`). Fix it with **Protection Bypass for Automation** (available on all plans, including Hobby):

1. Vercel project → **Settings → Deployment Protection → Protection Bypass for Automation** → add a secret (or use the existing
   one) and copy its value.
2. Put it in the **bot's** env as `VERCEL_PROTECTION_BYPASS_SECRET`. The bot sends it as the `x-vercel-protection-bypass` header
   on verify-start/confirm only when set. It is never logged.
3. **Leave it unset in production.**

(Vercel also exposes the same secret to your deployments as `VERCEL_AUTOMATION_BYPASS_SECRET` — that's its name on the Vercel
side; the bot's variable is named differently on purpose.)

### 4d. The URL the bot calls
Use the branch's **stable** preview URL, not a per-commit one (those change on every push). It looks like
`https://<project>-git-discord-link-model-<team>.vercel.app` (slashes in the branch name become dashes). Copy the exact one from
the Vercel dashboard → the project's **Domains**/deployment page. That's `REIBLAST_SERVER_URL`: scheme + host only, no path.

---

## 5. Run it locally

```bash
cp .env.example .env        # then fill in every value; names are in .env.example
npm run build               # register-commands runs from dist/
npm run register-commands   # registers /setup-verify in DISCORD_GUILD_ID
npm run dev                 # tsx watch, loads .env
```

`.env` needs (names only; see `.env.example` for the full list and comments):
`DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`, `DISCORD_REIBLAST_ROLE_ID`, `DISCORD_VERIFY_CHANNEL_ID`,
`DISCORD_STAFF_ROLE_ID`, `DISCORD_STAFF_LOG_CHANNEL_ID`, `REIBLAST_SERVER_URL`, `DISCORD_BOT_INBOUND_SECRET`,
`DISCORD_BOT_OUTBOUND_SECRET`, `SUPPORT_PHONE`, and optionally `VERCEL_PROTECTION_BYPASS_SECRET`. For Support Q&A (step 3b) also:
`DISCORD_SUPPORT_FORUM_ID`, `DISCORD_TAG_SUPPORT_ID`, `DISCORD_TAG_RESOLVED_ID`, `DISCORD_TAG_NEEDS_STAFF_ID`,
`DISCORD_SUPPORT_CHANNEL_ID`, `DISCORD_SUPPORT_ROLE_ID`, `ANTHROPIC_API_KEY`.
If anything is missing or malformed the bot exits immediately and prints the variable **names** that are wrong (never values).

**Smoke checks**
1. Logs show `http listening`, then `gateway ready`.
2. `curl -i http://localhost:3000/health` → `200 {"ok":true}` (503 while the gateway is still connecting).
3. In Discord, run **`/setup-verify`** (anywhere in the server). The panel appears in `#verify`. Someone without the staff role
   gets an ephemeral "Only REIblast staff can use this command".
   - If the command doesn't show up: re-run `register-commands`, check the invite had the `applications.commands` scope, and
     reload Discord (Ctrl/Cmd+R).

**End-to-end verify — your own account only**
1. In `#verify`, click **Verify with email**, enter the **signup email** of **your own** REIblast account (it must be eligible:
   onboarding done, active/provisioning, not a test account).
2. You should see "We sent a code to the phone ending in ####" and receive the SMS on your own phone.
3. **Enter Code** → the 6 digits → rules appear with **I agree** → click it → "You're in!" and the `REIblast` role appears.
4. Also try the refusal paths with *your own* data only: a wrong code (attempts left), a garbage email (local "doesn't look like an
   email" message). Don't probe with other people's emails — it sends nothing but still burns the server's rate limits and
   writes attempt rows.
5. As owner you can't see a real revoke on your own role if you're above the bot. To test revoke use a second, non-admin
   account you control (e.g. an alt), verified the same way, then:
   ```bash
   export DISCORD_BOT_OUTBOUND_SECRET=$(grep '^DISCORD_BOT_OUTBOUND_SECRET=' .env | cut -d= -f2-)
   curl -s -X POST http://localhost:3000/revoke \
     -H "content-type: application/json" \
     -H "x-reiblast-bot-secret: $DISCORD_BOT_OUTBOUND_SECRET" \
     -d '{"discordUserId":"<the alt account ID>"}'
   # → {"result":"ok","reason":"revoked"}   (a second call → "not_holding_role")
   ```

---

## 6. Railway

1. Push this repo to GitHub (it is only a local git repo right now).
2. Railway → **New Project → Deploy from GitHub repo** → pick it. `railway.json` supplies the build
   (`npm ci && npm run build`), start (`npm start`), the `/health` check and the **Always restart** policy.
3. **Variables** tab: add every variable from `.env.example`. Do **not** set `PORT` (Railway injects it). Leave
   `VERCEL_PROTECTION_BYPASS_SECRET` unset for production.
   - **Add these seven BEFORE pushing the Q&A code.** The bot exits at boot, listing the missing names, if any is absent (a deploy
     without them will crash-loop and take verification down with it): `DISCORD_SUPPORT_FORUM_ID`, `DISCORD_TAG_SUPPORT_ID`,
     `DISCORD_TAG_RESOLVED_ID`, `DISCORD_TAG_NEEDS_STAFF_ID`, `DISCORD_SUPPORT_CHANNEL_ID`, `DISCORD_SUPPORT_ROLE_ID`,
     `ANTHROPIC_API_KEY`.
   - Also turn **Message Content Intent** ON in the Developer Portal first (step 1), or login fails with "Used disallowed intents".
   - Re-invite the bot with the new permission integer (step 3) and set up the forum and Support channel (step 3b) for the
     server it will run in.
4. Confirm in the first build log that it's running **Node 22** (`engines` and `.nvmrc` pin it). If it picked another version, set
   a `NODE_VERSION=22` variable and redeploy.
5. **Settings → Networking → Generate Domain** first, and check `https://<generated>.up.railway.app/health` → `200 {"ok":true}`.
6. **Custom domain** `bot.reiblast.app`: Settings → Networking → **Custom Domain** → enter it. Railway shows a **CNAME target**
   (and possibly a TXT verification record). Add the **CNAME for `bot` only** at wherever `reiblast.app`'s DNS lives (if that's
   Vercel DNS, add it under the domain's DNS records in Vercel). The root domain stays on Vercel — don't touch the apex.
   Wait for the certificate to issue, then:
   ```bash
   curl -i https://bot.reiblast.app/health      # → 200 {"ok":true}
   ```
7. Remember what the health check is: Railway uses it to decide whether a **deploy** is ready; it is not continuous monitoring.
   Crashes are covered by the Always-restart policy. Heartbeat monitoring is a later step.
8. Make sure your local `npm run dev` is stopped (see the warning at the top).

The server's revoke hook will call `https://bot.reiblast.app/revoke` — see [docs/revoke-contract.md](docs/revoke-contract.md).

---

## 7. Moving to the partner's server later

It is a config swap — no code change.

**Config that changes** (Railway variables, then it redeploys):

| Variable | New value |
|---|---|
| `DISCORD_GUILD_ID` | partner server ID |
| `DISCORD_REIBLAST_ROLE_ID` | the REIblast role in their server |
| `DISCORD_VERIFY_CHANNEL_ID` | their Verify channel |
| `DISCORD_STAFF_ROLE_ID` | their staff role |
| `DISCORD_STAFF_LOG_CHANNEL_ID` | their staff-log channel |
| `REIBLAST_SERVER_URL` | the **production** app URL (and unset `VERCEL_PROTECTION_BYPASS_SECRET`) |

`DISCORD_BOT_TOKEN` / `DISCORD_APPLICATION_ID` stay the same if you reuse the application. Consider rotating both shared secrets at
the switch and updating the production server's `DISCORD_BOT_INBOUND_SECRET` to match.

**Checklist**
1. **Who can invite the bot:** with **Public Bot OFF**, only you (or members of your developer Team) can add it to a server. The
   partner's admin needs the **Manage Server** permission *and* a way to authorize: either turn **Public Bot ON** for the
   moment of the invite, or add the admin to the application's Team (Developer Portal → Team). Send them the invite URL from
   step 3.
2. They create (or you map) the roles/channels from step 2 with the same permission pattern; **the Verify channel is the one
   channel open to `@everyone`**. Give the bot explicit View/Send/Embed access in the Verify and staff-log channels.
3. **Role hierarchy check — do this before announcing anything:** Server Settings → Roles → the bot's role must sit **above** the
   REIblast role. Then prove it works both ways with a non-admin test account of your own: verify (role granted), call `/revoke`
   (role removed). If either fails with Missing Permissions, the order is wrong.
4. Run `npm run register-commands` with the new `DISCORD_GUILD_ID` (commands are per-server). Let staff use it: the command
   defaults to Manage Server; to let the staff role use it without that permission, use **Server Settings → Integrations →
   (bot) → `/setup-verify`** and add the staff role. The bot still re-checks the staff role itself.
5. Run `/setup-verify` once in their server, then pin the Verify instructions.
6. Remove the bot from your test server (or delete its panel) so old buttons there stop working — the verify flow itself isn't
   guild-scoped, only the role grant is.

---

## After any KB or Q&A rules edit

Run `npm run kb:check`, then `npm run eval:qa` (real API, about $0.05; needs `ANTHROPIC_API_KEY` in `.env`) and review the table **before deploying**.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Bot exits at boot listing variable names | Missing/malformed env var (or the two secrets are equal) |
| Boot says `content/rules.md is too long` | Trim the rules file to ≤ 6000 characters |
| `/health` is 503 | Gateway not connected yet, or bad token / Server Members intent off |
| "Used disallowed intents" on login | Server Members Intent **or Message Content Intent** not enabled in the Developer Portal |
| Boot says `kb invalid: <file>.md:<line>: …` | A `kb/*.md` entry is malformed (or contains an @mention); run `npm run kb:check` |
| `qa_misconfigured` alert | The startup setup check found a problem: see the codes in the bot log (step 3b) |
| Bot never answers in the forum | Support tag not on the post, Message Content Intent off, or `setup check` problems; also check `qa_*` alerts |
| Escalation says "handing this to the team" but nobody was pinged | The bot lacks **Mention Everyone** and the support role isn't mentionable (`support_role_not_pingable`) |
| `qa_tag_swap_failed` alert | The bot lacks **Manage Threads** in the forum, or a tag ID is wrong |
| `qa_escalation_failed` alert | Private thread couldn't be created: the bot needs **Create Private Threads**, **Send Messages in Threads** and **Manage Threads** in the Support channel |
| Staff can't see a private thread | The support role needs **Manage Threads** on the Support channel (private threads are only visible to added members and moderators) |
| Everyone gets "We couldn't verify you automatically" | Often server-side: missing GHL env vars (`delivery_failed`), wrong DB, wrong `REIBLAST_SERVER_URL` |
| "Something went wrong on our end" + a staff alert | `auth_failed` / `auth_missing` / `server_misconfigured`: the two `DISCORD_BOT_INBOUND_SECRET` values differ or are unset |
| "Something went wrong on our end", no alert | `internal_error`: server error, timeout, or an HTML page (check preview protection, step 4c) |
| `role_missing_permissions` alert | Bot role below the REIblast role, or Manage Roles missing |
| Slash command missing | `register-commands` not run for this guild, or invite lacked `applications.commands` |
| Duplicate / "already acknowledged" replies | Two bot processes running with the same token |
