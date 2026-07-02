# GenAI Scout

A **$0 AI writer sourcing engine** that automatically discovers and profiles every blogger, journalist, and publisher who covers generative AI tools — and turns them into a ranked, browsable, exportable contact database for editorial outreach.

## What it does

- **Discovers** writers via GDELT, Hacker News, Reddit, RSS/sitemaps, WordPress REST API, Ghost CMS, Common Crawl, and Wayback Machine
- **Profiles** each author: avatar, bio, role, publication, contact surfaces (email, author page, Twitter, LinkedIn)
- **Scores** prospects 0-100 by relevance, freshness, authority, competitor overlap, and contact confidence
- **Flags link-gap opportunities**: authors covering Kling/Runway/Midjourney who have not mentioned ImagineArt yet
- **Exports** as CSV/JSON for outreach

## Prerequisites

- Node.js 18+
- A free Supabase project (supabase.com)
- A Google Cloud OAuth 2.0 client (for @imagine.art login)

---

## Setup

### 1. Install dependencies

```bash
cd genai-scout
npm install
npx playwright install chromium
```

### 2. Run SQL migration

In Supabase dashboard -> SQL Editor -> New query, paste migrations/001_initial.sql and run it.

### 3. Set environment variables

```bash
cp .env.example .env.local
```

Fill in .env.local (see .env.example for all variables). The only required ones are:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- AUTH_SECRET (run: openssl rand -base64 32)
- GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
- ALLOWED_DOMAINS=imagine.art

### 4. Google OAuth

Go to console.cloud.google.com -> APIs & Services -> Credentials -> Create OAuth 2.0 Client ID.
Add http://localhost:3000/api/auth/callback/google as an authorised redirect URI.

### 5. Start

```bash
npm run dev
```

Visit http://localhost:3000, sign in with your @imagine.art Google account, click Run discovery.

---

## Architecture

```
/src/lib/harvesters/    8 discovery sources (GDELT, HN, Reddit, RSS, WordPress, Ghost, CC, Wayback)
/src/lib/extract/       fetch, metadata (JSON-LD/OG), readability, contacts, mentions, archetype
/src/lib/score/         composite scoring (relevance 35%, competitor 20%, authority 20%, freshness 15%, contact 10%)
/src/lib/pipeline/      orchestrator: discover -> canonicalize -> fetch -> extract -> score
/src/app/page.tsx       main dashboard
/src/app/admin/         seed editor, harvester toggles, suppression list, pipeline logs
/src/app/settings/      API key status
/migrations/001_initial.sql   full Supabase schema
/config/seeds.ts        tool list + query archetypes
/auth.ts                NextAuth v5 (Google OAuth, domain restriction)
```

## Scoring

| Signal | Weight | Method |
|---|---|---|
| Relevance | 35% | Tool mention density + archetype bonus (listicle/comparison +15pts) |
| Competitor overlap | 20% | Competitor tools mentioned without ImagineArt |
| Authority | 20% | Article count + cross-query presence |
| Freshness | 15% | Recency decay over 180 days |
| Contact confidence | 10% | Best published contact surface found |

## Vercel deployment

Set PLAYWRIGHT_ENABLED= (empty) on Vercel. The app falls back to static fetching (covers ~85% of sites). Add the Vercel URL as an OAuth redirect URI in Google Cloud Console.

## Cost

Everything used is free: Supabase free tier, GDELT open API, HN Algolia open API, Reddit JSON, Common Crawl, Wayback Machine, Vercel hobby tier. Total: $0.
