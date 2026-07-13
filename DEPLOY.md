# Deploy — quick start (self-hosted, off Vercel)

Copy-paste guide to run GenAI Scout on your own server. For the full explanation of every
variable and every gotcha, see **[DEPLOYMENT.md](./DEPLOYMENT.md)**. This page is the fast path.

Use a **persistent Node server** (VPS, Render, Railway, Fly.io, Docker) — not a short-timeout
serverless platform. Node **20+**. All data/cache/scheduler/email are external SaaS — reuse the
same accounts; there's nothing to migrate.

---

## 1. Env file

Create `.env.local` (or set these in your host's dashboard). Copy values from the current
deployment. The ones people forget are marked ⚠️.

```bash
# --- Database (Supabase) — reuse the existing project, nothing to migrate ---
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

# --- Auth ---
AUTH_SECRET=                 # ⚠️ MUST equal the old value (also decrypts saved Gmail passwords)
AUTH_TRUST_HOST=true         # ⚠️ REQUIRED off Vercel, or login 500s
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_DOMAINS=imagine.art

# --- New public URL ---
APP_URL=https://YOUR-DOMAIN          # ⚠️ your new domain
NEXTAUTH_URL=https://YOUR-DOMAIN     # ⚠️ same

# --- Cache + scheduler (Upstash) — reuse ---
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
QSTASH_TOKEN=
CRON_SECRET=                 # ⚠️ keep same; protects the cron endpoints

# --- AI + search + email ---
OPENROUTER_API_KEY=
TAVILY_API_KEY=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=waleed.idrees@imagine.art
SMTP_PASS=                   # Gmail app password
SMTP_FROM_EMAIL=waleed.idrees@imagine.art

# --- Optional ---
PLAYWRIGHT_ENABLED=false     # true (+ install chromium) = better scraping on a real server
# BRAVE_SEARCH_API_KEY= GOOGLE_CSE_KEY= GOOGLE_CSE_CX= SERPER_API_KEY= SGAI_API_KEY=
# OPEN_PAGE_RANK_API_KEY= BLITZ_API_KEY= HUNTER_API_KEY= REOON_API_KEY= SLACK_BROKEN_LINKS_WEBHOOK=
# Do NOT set VERCEL.
```

## 2. Google OAuth (one console change)

Google Cloud Console → your OAuth client → **Authorized redirect URIs**, add:
```
https://YOUR-DOMAIN/api/auth/callback/google
```

## 3. Build & run

### Option A — directly on the box
```bash
npm ci
npm run build
npm start                      # port 3000 (PORT=8080 to change)
# keep alive: pm2 start "npm start" --name genai-scout
```

### Option B — Docker
```bash
docker build -t genai-scout .
docker run -d --name genai-scout --env-file .env.local -p 3000:3000 genai-scout
```
Uses the `Dockerfile` in this repo. Put nginx/Caddy in front for HTTPS (or use the platform's TLS).

## 4. Repoint the scheduler (crons)

Recurring jobs are Upstash **QStash** schedules (send emails every 30 min; daily audit at 08:00
UTC). Point them at the new URL and remove the old Vercel ones:
```bash
node scripts/setup-qstash.mjs https://YOUR-DOMAIN
# then delete the schedules still pointing at *.vercel.app in the Upstash QStash console
```
No QStash? A plain crontab works too:
```
*/30 * * * *  curl -s -X POST https://YOUR-DOMAIN/api/emails/process -H "Authorization: Bearer $CRON_SECRET"
0    8 * * *  curl -s -X POST https://YOUR-DOMAIN/api/cron/daily     -H "Authorization: Bearer $CRON_SECRET"
```
(`vercel.json`'s cron is Vercel-only and simply ignored elsewhere — QStash/crontab covers it.)

## 5. Smoke test

1. Open the site → sign in with an `@imagine.art` Google account.
2. Prospects loads (DB ok) · Settings shows Tavily keys (Redis ok).
3. Sending → "Process now" succeeds (SMTP ok).
4. Inbox → open someone with a reply → thread loads (IMAP ok).

**If login fails** → missing `AUTH_TRUST_HOST=true` or the OAuth redirect URI / `NEXTAUTH_URL`.
**If emails never auto-send** → QStash still points at the old URL, or `CRON_SECRET` mismatch.

> New/empty database instead of the current Supabase? First run `migrations/001_initial.sql`,
> then every `scripts/0NN_*.mjs` in order (001→030) with `DATABASE_URL` set. Against the current
> Supabase this is already done — skip it.
