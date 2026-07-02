# Deploying GenAI Scout to Vercel

## 1. Push the repo & import into Vercel

1. Push this project to a Git repo (GitHub/GitLab).
2. In Vercel → **Add New Project** → import the repo. Framework preset auto-detects **Next.js**. Root directory = `genai-scout`.
3. Don't deploy yet — set env vars first (step 2).

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)

Copy every key from your local `.env.local`. Grouped by purpose:

**Supabase / DB**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`

**Auth (Google OAuth, restricted to your domain)**
- `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_DOMAINS`
- `NEXTAUTH_URL` and `APP_URL` → set both to your deployed URL, e.g. `https://your-app.vercel.app`
  (also add that URL to the Google OAuth **Authorized redirect URIs**: `https://your-app.vercel.app/api/auth/callback/google`)

**Email sending (Gmail SMTP)**
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`

**Scheduling / durability**
- `CRON_SECRET` — protects the send-processor endpoint (Vercel cron + QStash send it as a Bearer token)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — send-lock, daily-cap counters
- `QSTASH_TOKEN` — from console.upstash.com → **QStash** tab (needed for the every-30-min trigger; see step 4)

**Finders / search (all free tiers)**
- `BLITZ_API_KEY`, `REOON_API_KEY`, `HUNTER_API_KEY`, `TAVILY_API_KEY`, `OPENROUTER_API_KEY`
- Optional extra search providers: `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX`, `SERPER_API_KEY`, `BRAVE_SEARCH_API_KEY`
- `OPEN_PAGE_RANK_API_KEY`, `SGAI_API_KEY` (optional)

**Serverless note**
- Set `PLAYWRIGHT_ENABLED=false` (or omit it). Vercel can't launch Chromium; the harvesters/finders fall back to plain fetch automatically.

> Never commit `.env.local` — it's gitignored. Set these only in the Vercel dashboard.

## 3. Deploy

Click **Deploy**. First build runs `next build`. After it's live, confirm you can sign in with your Google account (must be on an `ALLOWED_DOMAINS` domain).

## 4. Turn on timezone-aware sending (Upstash QStash)

Vercel **Hobby** crons only fire **once per day**, which isn't enough to send at each recipient's local time. `vercel.json` includes that daily cron as a baseline, but for accurate per-timezone delivery use QStash to ping the processor every 30 minutes:

1. In console.upstash.com open the **QStash** tab, copy `QSTASH_TOKEN` into `.env.local` **and** Vercel env vars.
2. Run once locally, pointing at your deployed URL:
   ```
   node scripts/setup-qstash.mjs https://your-app.vercel.app
   ```
   This creates a schedule that POSTs `https://your-app.vercel.app/api/emails/process` every 30 min, forwarding `Authorization: Bearer <CRON_SECRET>`.
3. Verify in the QStash dashboard under **Schedules**. Re-running the script replaces the old schedule (idempotent).

That's it — the processor is idempotent and lock-guarded, so the Vercel daily cron and the QStash schedule can both point at it safely.

## 5. Run DB migrations against prod (if not already applied)

Migrations are additive column/table adds. With `DATABASE_URL` pointing at your Supabase DB:
```
node scripts/006_email_send_config.mjs
node scripts/007_author_timezone.mjs
node scripts/008_enrich_prospect_emails.mjs
node scripts/009_enrichment_runs.mjs
node scripts/010_contacted_override.mjs
```

## How sending works in production

1. Generate emails in a workflow → **Send All** schedules each email at its recipient's **local** send-window time (timezone inferred per person; the config timezone is only a fallback).
2. QStash (every 30 min) → `/api/emails/process`:
   - acquires a Redis **lock** (overlapping triggers never double-send),
   - loads each email's workflow **send config** (from name/email), sends via SMTP,
   - increments a per-workflow **daily-cap** counter in Redis.
3. Watch the **Sending** page — live queue (cancel/edit before send) and sent/failed list.
