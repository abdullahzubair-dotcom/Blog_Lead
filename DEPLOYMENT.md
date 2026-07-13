# Deploying GenAI Scout off Vercel

This app is a standard **Next.js 16 (App Router)** server. It does NOT need Vercel — it runs on
any host that can run a long-lived Node process. All the heavy lifting (database, cache,
scheduler, search, email) is **external SaaS**, so moving hosts is mostly: run the Node app
somewhere, set the env vars, and repoint two scheduled jobs. Nothing is locked to Vercel.

---

## 1. Pick the right kind of host

Use a host that runs a **persistent Node process**: a VPS (DigitalOcean/Hetzner/EC2), or a
container platform (Render, Railway, Fly.io, a Docker host). **Avoid other "serverless
function" platforms** (Netlify Functions, Cloudflare Workers, etc.).

Why this matters: discovery, email sending, the link audit and email enrichment run as
**background work after the HTTP response** (Next.js `after()`), and some runs take minutes.
- On Vercel the code detects the platform (`process.env.VERCEL`) and chops long jobs into
  ≤210s chunks that resume via QStash — a workaround for Vercel's 300s function limit.
- On a **normal server** that limit doesn't exist, so `isServerless()` is false and jobs simply
  **run to completion in one process** (simpler and more reliable) — as long as the process
  isn't killed mid-run. A persistent Node server is exactly that. A short-timeout serverless
  platform would kill jobs and isn't auto-detected, so don't use one.

Node **20 or 22 LTS** recommended (Next.js 16 requires Node ≥18.18; use 20+).

---

## 2. External services — reuse the existing ones (no migration needed)

Keep using the same accounts; just carry the keys over. None of these are Vercel-tied:

| Service | Used for | Action when moving |
|---|---|---|
| **Supabase** (Postgres) | all app data | Reuse. Nothing to migrate — same `DATABASE_URL` + keys. |
| **Upstash Redis** | run locks, checkpoints, live progress, Tavily key pool, rate limits | Reuse. State (incl. the Tavily key pool) carries over automatically. |
| **Upstash QStash** | the scheduler (see §5) | Reuse token; **repoint schedules to the new URL** (§5). |
| **OpenRouter** | AI (openers, follow-ups, sentiment, query gen) | Reuse key. |
| **Tavily** (+ pool) | web search for discovery | Reuse. Extra keys live in Redis, carried over. |
| **Gmail (app passwords)** | sending + reading email (SMTP/IMAP) | Reuse. Stored encrypted in DB; no change. |
| **Slack webhook** | link-audit digest | Reuse. |
| **Google OAuth** | login | **Add the new domain's callback URL** (§4). |

> The Supabase DB is **shared with other projects** — do not drop/rename tables. If you point
> at the *same* Supabase, all migrations are already applied; there's nothing to run.

---

## 3. Environment variables

Copy the existing `.env.local` values. Full list:

### Required (app will not work without these)
```
# Database (Supabase)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=                     # only used by migration scripts; keep it anyway

# Auth (NextAuth + Google OAuth)
AUTH_SECRET=                      # 32+ char random; ALSO the encryption key for stored app passwords — MUST stay identical or saved Gmail passwords can't be decrypted
AUTH_TRUST_HOST=true              # <-- REQUIRED off Vercel (see §4); login breaks without it
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_DOMAINS=imagine.art       # comma-separated allowed login domains

# Public URL of the new deployment (used to build QStash continuation URLs, cron self-calls, OAuth)
APP_URL=https://YOUR-NEW-DOMAIN
NEXTAUTH_URL=https://YOUR-NEW-DOMAIN

# Cache / scheduler (Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
QSTASH_TOKEN=
CRON_SECRET=                      # shared secret protecting cron/QStash endpoints; must match what QStash sends

# AI + search + email
OPENROUTER_API_KEY=
TAVILY_API_KEY=                   # base key; more can be added in-app (Settings → Tavily keys)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=waleed.idrees@imagine.art
SMTP_PASS=                        # Gmail app password for SMTP_USER
SMTP_FROM_EMAIL=waleed.idrees@imagine.art
SMTP_FROM_NAME=
```

### Optional (features degrade gracefully if unset)
```
PLAYWRIGHT_ENABLED=false          # true on a real server = better scraping (see §6)
TAVILY_MONTHLY_LIMIT=1000
BRAVE_SEARCH_API_KEY=   GOOGLE_CSE_KEY=   GOOGLE_CSE_CX=   SERPER_API_KEY=   # extra search providers
SGAI_API_KEY=                     # ScrapeGraph (LLM search)
OPEN_PAGE_RANK_API_KEY=           # domain-authority signal
BLITZ_API_KEY=   HUNTER_API_KEY=   REOON_API_KEY=          # email-finding providers
SLACK_BROKEN_LINKS_WEBHOOK=       # link-audit digest
ENRICH_ON_DISCOVERY=              # leave unset; email-finding runs on-demand
QSTASH_URL= QSTASH_CURRENT_SIGNING_KEY= QSTASH_NEXT_SIGNING_KEY=  # only if you verify QStash signatures
# Do NOT set VERCEL — its absence is how the app knows it's on a normal server.
```

---

## 4. Auth — the #1 thing that breaks off Vercel

NextAuth (v5) rejects requests from an "untrusted host" unless told otherwise. On Vercel it
auto-trusts; **elsewhere you MUST set `AUTH_TRUST_HOST=true`** or every login 500s.

Also, in **Google Cloud Console → Credentials → your OAuth client**, add the new callback URL to
**Authorized redirect URIs**:
```
https://YOUR-NEW-DOMAIN/api/auth/callback/google
```
(Keep the old Vercel one too if you want both to work during cutover.) Set `APP_URL` and
`NEXTAUTH_URL` to the new domain. `AUTH_SECRET` must be **the exact same value** as before —
it's also the key that decrypts the Gmail app passwords stored in the DB; change it and every
saved sender password becomes unreadable.

---

## 5. Cron jobs / background schedules — the other big one

There are **two schedulers in the repo; only QStash matters off Vercel:**

1. **Upstash QStash (primary, host-independent).** It pings two URLs on a schedule:
   - `*/30 * * * *` → `POST /api/emails/process`  (send due emails, detect replies, schedule follow-ups)
   - `0 8 * * *` → `POST /api/cron/daily`  (broken-link audit + author-watch notifications)
   These currently point at `https://blog-lead.vercel.app`. **Repoint them to the new URL:**
   ```
   node scripts/setup-qstash.mjs https://YOUR-NEW-DOMAIN
   ```
   That script creates the two schedules against the new host and forwards `CRON_SECRET`.
   **Then delete the old schedules still pointing at the Vercel URL** (otherwise they keep
   hitting the dead/paused Vercel app). List/remove them in the Upstash QStash console, or with
   the QStash API — the setup script only replaces schedules for the URL you pass it.

2. **`vercel.json` cron (Vercel-only, ignore).** It has a daily `/api/emails/process` backup
   cron. On a non-Vercel host this file does nothing — that's fine, QStash's every-30-min
   schedule already covers it. You can leave the file as-is.

**If you'd rather not use QStash at all** (e.g. run everything on the box): every scheduled job
is just an authenticated HTTP POST, so a plain system crontab works too:
```
*/30 * * * *  curl -s -X POST https://YOUR-NEW-DOMAIN/api/emails/process -H "Authorization: Bearer $CRON_SECRET"
0    8 * * *  curl -s -X POST https://YOUR-NEW-DOMAIN/api/cron/daily     -H "Authorization: Bearer $CRON_SECRET"
```
(On a normal server, discovery no longer needs QStash to *continue* long runs — it finishes
in one process — so QStash is only the timer. Either QStash or crontab is enough.)

The endpoints authorize via `CRON_SECRET` (Bearer or `?key=`) **or** a logged-in session, and
`src/proxy.ts` lets those secret-bearing calls past the login wall — so keep `CRON_SECRET` set.

---

## 6. Playwright (optional upgrade on a real server)

Scraping falls back to fast static fetch (Cheerio) when `PLAYWRIGHT_ENABLED` is not `true`.
On a real server (unlike Vercel) you *can* run a headless browser for better coverage:
```
npx playwright install --with-deps chromium
# then set PLAYWRIGHT_ENABLED=true
```
Optional. `false` is completely fine.

---

## 7. Build & run

```
npm ci
npm run build
npm start            # serves on port 3000 (override with PORT=...)
```
Put a reverse proxy (nginx/Caddy) in front for TLS, or use the platform's built-in TLS.
Keep it alive with the platform's process manager, or `pm2 start "npm start" --name genai-scout`.

**Docker** (if preferred): a standard Node 20 image, `npm ci && npm run build`, `CMD ["npm","start"]`,
expose 3000. (No `output: "standalone"` is configured, so ship `node_modules` or run `next start`.)

### If you ever move to a brand-new database (not the current Supabase)
Only then do you need to create the schema: run `migrations/001_initial.sql` in the new
Postgres, then every `scripts/0NN_*.mjs` **in numeric order** (`004` … `030`) with `DATABASE_URL`
pointed at the new DB. Against the current Supabase this is already done — skip it.

---

## 8. Post-deploy smoke checklist

- [ ] Visit the site → redirected to Google login → sign in with an `@imagine.art` account (fails here = `AUTH_TRUST_HOST` / OAuth redirect URI / `NEXTAUTH_URL`).
- [ ] Prospects page loads data (confirms Supabase envs).
- [ ] Settings → Tavily keys shows the pool (confirms Redis).
- [ ] Sending page → "Process now" returns without error (confirms SMTP + Redis lock).
- [ ] Inbox → open a person with a reply → the thread loads (confirms IMAP app passwords).
- [ ] `node scripts/setup-qstash.mjs https://YOUR-NEW-DOMAIN` printed 2 schedules; old Vercel schedules deleted.
- [ ] Wait for (or manually POST) `/api/emails/process` → emails send on time.
- [ ] Trigger `/api/cron/daily` (or wait for 08:00 UTC) → Slack link-audit digest arrives.

## 9. Common failure → cause
- **Login 500 / "UntrustedHost"** → `AUTH_TRUST_HOST=true` missing.
- **Login redirect mismatch** → new callback URL not added in Google Console, or `NEXTAUTH_URL` wrong.
- **Saved Gmail passwords "invalid"** → `AUTH_SECRET` changed (must be identical to before).
- **Emails never send automatically** → QStash still points at old URL, or `CRON_SECRET` mismatch.
- **Discovery/audit never run on schedule** → same as above (QStash repoint).
- **Discovery starts then dies** → host is a short-timeout serverless platform; use a persistent Node server.
