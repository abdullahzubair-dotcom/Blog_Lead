# GenAI Scout — Complete Product & Engineering Documentation

> Writer discovery → AI-personalized outreach → reply detection → AI negotiation → payment tracking.
> A Next.js 16 app for ImagineArt's editorial-outreach team.

**Scope:** every page, every button, every API route, every check, every flow, and every edge case / caution in the app.
**Generated from the codebase on 2026-07-22.** Section anchors and file paths point at the real source; verify against current code before relying on any specific line number.

---

## Table of Contents

1. [Overview & Architecture](#overview--architecture)
2. [Navigation, Authentication & Login](#navigation-authentication--login)
3. [Discovery Pipeline (Dashboard / Home)](#discovery-pipeline-dashboard--home)
4. [Campaigns](#campaigns)
5. [Workflows (Prospect Lists)](#workflows-prospect-lists)
6. [Emails (Generate & Send)](#emails-generate--send)
7. [Sending (Scheduled & Sent)](#sending-scheduled--sent)
8. [Negotiation (AI Reply Handling)](#negotiation-ai-reply-handling)
9. [Inbox (Conversations)](#inbox-conversations)
10. [Payments](#payments)
11. [Handbook (Negotiation Settings)](#handbook-negotiation-settings)
12. [Email Finder & Enrichment](#email-finder--enrichment)
13. [Link Audit & Page Health (Indexing)](#link-audit--page-health-indexing)
14. [Notifications & Author Watches](#notifications--author-watches)
15. [Settings (Your Sending Email & Keys)](#settings-your-sending-email--keys)
16. [Admin (Shared Senders, Tavily, Suppression, Digest, Wipe)](#admin-shared-senders-tavily-suppression-digest-wipe)
17. [Cross-Cutting Backend Flows, Checks & Edge Cases](#cross-cutting-backend-flows-checks--edge-cases)

---

## Overview & Architecture

### Purpose

**GenAI Scout** is an internal editorial-outreach engine for ImagineArt (an AI image/video generation product). Its stated mission (`README.md`) is a "$0 AI writer sourcing engine" that discovers and profiles every blogger, journalist, and publisher covering generative-AI tools, then turns them into a ranked, browsable, exportable contact database — and drives the full outreach lifecycle on top of that data.

The product is one continuous pipeline across five stages:

1. **Writer discovery** — harvest article URLs from many free sources, canonicalize, fetch, extract author/contact/mention metadata, score, and persist prospects.
2. **Outreach** — filter prospects into workflows, find their emails/LinkedIn, generate AI-personalized emails, schedule them per-recipient-timezone, and drip-send from each teammate's own Gmail.
3. **Reply detection** — an IMAP sweep matches inbound replies back to sent threads and classifies them (reply / bounce / auto-reply, plus sentiment/intent).
4. **AI negotiation** — when a writer replies, an LLM agent drafts (or, with autonomy on, auto-sends) negotiation replies bounded by a pricing handbook and per-domain price ceilings.
5. **Payment tracking** — once a placement is agreed, the deal moves through owed → requested → paid on the negotiation anchor row.

Two adjacent, self-contained tools ride on the same shell and infra: a **Link Audit / Page Health** hub (broken-link crawler + indexability/Core-Web-Vitals scanner for imagine.art, with Slack digests) and an **Email Finder / enrichment** subsystem.

This document is the big-picture map: product surface, tech stack, environment, data model, scheduling, deployment, and a one-line-per-page tour. Deep per-feature behavior lives in the other sections.

---

### Tech stack & versions

Anchor: `package.json`, `next.config.ts`, `tsconfig.json`, `AGENTS.md`.

**Framework / runtime**
- **Next.js `16.2.9`** (App Router) with **React `19.2.4`** / react-dom `19.2.4`, TypeScript `^5`.
- `AGENTS.md`/`CLAUDE.md` warn that this Next.js version has breaking changes vs. common training data — e.g. request middleware lives in **`src/proxy.ts`** (exporting a `proxy()` function), **not** `middleware.ts`; UI primitives use `@base-ui/react` (no `asChild`). Consult `node_modules/next/dist/docs/` before editing.
- Node 18.18+ required; **20/22 LTS recommended** (`DEPLOYMENT.md`).
- `next.config.ts`: allows remote images from any http/https host; `serverActions.bodySizeLimit: "10mb"`; `serverExternalPackages: ["playwright","playwright-core","jsdom","@mozilla/readability"]` (kept out of the bundler so they run as real Node modules).

**Path aliases** (`tsconfig.json`): `@/*` → `src/*`, `@auth` → `./auth`, `@config/*` → `./config/*`.

**Auth**: `next-auth@^5.0.0-beta.31` (Auth.js v5) with Google OAuth (`@auth/supabase-adapter` present).

**Data / infra**
- **Supabase** (`@supabase/supabase-js`, `@supabase/ssr`) — Postgres + REST. Two clients in `src/lib/db/supabase.ts`: anon `supabase` and service-role `supabaseAdmin` (bypasses RLS, `persistSession:false`).
- **Upstash Redis** (`@upstash/redis`) — distributed locks, daily-cap counters, live progress, discovery run meta.
- **Upstash QStash** (`@upstash/qstash`) — the real scheduler + long-job continuation.

**AI / LLM**
- `@anthropic-ai/sdk`, `openai`, `ai` (Vercel AI SDK) are all installed, but the live path is **OpenRouter** (`OPENROUTER_API_KEY`) used for openers, follow-ups, reply sentiment/intent, negotiation drafts, and query generation. `.env.example` references Claude `claude-haiku-4-5-20251001`; `README`/`health` label OpenRouter as the generation provider.

**Scraping / extraction**: `playwright` + `playwright-core` (JS-rendered fetch, gated by `PLAYWRIGHT_ENABLED`), `cheerio` (static fallback), `jsdom` + `linkedom` + `@mozilla/readability` (article text), `metascraper*` (JSON-LD/OG metadata), `rss-parser`, `fast-xml-parser` (sitemaps), `scrapegraph-js`.

**Email**: `nodemailer` (SMTP send), `imapflow` (IMAP reply reading), `deep-email-validator`.

**Enrichment / matching**: `fastest-levenshtein`, `string-similarity`, `google-auth-library` (GSC / service accounts), `@octokit/rest` (Link Audit → GitHub PRs).

**UI**: Tailwind CSS v4 (`@tailwindcss/postcss`), shadcn-style components over `@base-ui/react`, `lucide-react` icons, `recharts` charts, `sonner` toasts, `next-themes` (dark default), `cmdk`, `Poppins` font. Concurrency via `p-queue`.

---

### Environment variables

Every `process.env.*` referenced in the codebase, grouped by purpose. Required = app is non-functional without it. Optional integrations degrade gracefully (their absence disables just that feature; see `.env.example`, `DEPLOYMENT.md`, `src/lib/health/keys.ts`).

**Required — Supabase / DB**
| Var | Powers |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (both clients) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public/anon Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server `supabaseAdmin` client (bypasses RLS) |
| `DATABASE_URL` | Direct Postgres connection — used **only** by the `scripts/0NN_*.mjs` migration/runner scripts (via `pg`), not the app runtime |

**Required — Auth**
| Var | Powers |
|---|---|
| `AUTH_SECRET` | NextAuth session signing **and** the AES-256-GCM key that encrypts stored Gmail app passwords (`src/lib/crypto.ts`) — changing it makes saved sender passwords undecryptable |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth provider (`auth.ts`) |
| `ALLOWED_DOMAINS` | Comma-separated login-domain allowlist; default `imagine.art` (`auth.ts`) |
| `NEXTAUTH_URL` | Canonical app URL for auth callbacks |
| `AUTH_TRUST_HOST` | **Required off Vercel** (`=true`) or every login 500s (`DEPLOYMENT.md`) |

**Scheduling / automation**
| Var | Powers |
|---|---|
| `CRON_SECRET` | Shared secret authorizing cron/QStash calls (Bearer or `?key=`); `src/proxy.ts` lets matching calls past the login wall |
| `QSTASH_TOKEN` | Publish QStash messages (scheduler + long-job continuation) |
| `QSTASH_URL`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | QStash endpoint / signature verification (optional) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Redis locks, daily-cap counters, live progress; if unset, `redis()` returns null and callers fall back to in-memory single-instance behavior |
| `APP_URL` | Base URL for self-calls (cron fan-out, QStash continuation), robots UA contact |
| `VERCEL` | Set to `"1"` by Vercel; `isServerless()` reads it to decide whether to chunk long jobs. **Do not set manually off Vercel** |

**AI + search**
| Var | Powers |
|---|---|
| `OPENROUTER_API_KEY` | All LLM generation (descriptions, openers, follow-ups, sentiment/intent, negotiation) |
| `ANTHROPIC_API_KEY` | Optional direct Claude for author descriptions (`.env.example`) |
| `TAVILY_API_KEY` / `TAVILY_MONTHLY_LIMIT` | Web search for discovery (recommended provider); extra keys pooled in Redis |
| `GOOGLE_CSE_KEY` / `GOOGLE_CSE_CX` | Google Custom Search provider |
| `SERPER_API_KEY` | Serper search provider |
| `BRAVE_SEARCH_API_KEY` | Brave Search provider |
| `SGAI_API_KEY` | ScrapeGraphAI (LLM web search + scrape) |

**Email send / read**
| Var | Powers |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Fallback/shared SMTP sender (Gmail app password) |
| `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL` | Default From identity |

**Enrichment providers** (email finding / verification / authority)
| Var | Powers |
|---|---|
| `BLITZ_API_KEY` | BlitzAPI LinkedIn/company enrichment + optional send provider |
| `HUNTER_API_KEY` | Hunter.io email finder |
| `REOON_API_KEY` | Reoon email verifier |
| `OPEN_PAGE_RANK_API_KEY` | OpenPageRank domain-authority signal |
| `AHREFS_API_KEY` | Ahrefs Domain Rating / traffic (qualification) |
| `PLAYWRIGHT_ENABLED` | `"true"` enables headless-Chromium scraping; keep unset/false on Vercel |
| `ENRICH_ON_DISCOVERY` | Gate email-finding during discovery (left unset; finding is on-demand) |

**Link Audit / Page Health / Indexing hub**
| Var | Powers |
|---|---|
| `SLACK_BROKEN_LINKS_WEBHOOK` | Slack digest for link audit + page health |
| `PAGESPEED_API_KEY` | Google PageSpeed / Core Web Vitals |
| `GSC_PROPERTY`, `GSC_SA_JSON`, `GSC_SA_JSON_BASE64` | Google Search Console service-account access (`docs/GSC_SETUP.md`) |
| `GITHUB_BOT_TOKEN`, `TARGET_REPO`, `TARGET_REPO_BASE_BRANCH` | Open fix PRs against the site repo |
| `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, `LINEAR_TEAM_KEY`, `LINEAR_PROJECT_ID` | File Linear tickets from findings |

**Access control**
| Var | Powers |
|---|---|
| `ADMIN_EMAILS` | Comma-separated admin allowlist (send-as, wipe, shared senders); defaults to `abdullah.zubair@imagine.art` (`src/lib/auth/admin.ts`) |

> Note: `.env.local` currently ships real secrets committed to the working tree (Supabase keys, Google OAuth secret, SMTP app password, Blitz/Hunter/Reoon/Tavily/OpenRouter keys, Upstash + QStash tokens). Treat these as live credentials.

---

### Data model

Postgres (Supabase). Base schema is `migrations/001_initial.sql`; everything after was added incrementally by the `scripts/0NN_*.mjs` migration scripts (each connects via `pg` using `DATABASE_URL`). **RLS caveat:** scripts `024`/`025` enable Row Level Security on the tables but add a permissive `allow_all` policy (and do **not** set `FORCE ROW LEVEL SECURITY`); the app uses the service-role key, so it bypasses RLS regardless. The Supabase DB is **shared with other projects** — do not drop/rename tables (`DEPLOYMENT.md`).

**Provenance note:** the core outreach tables **`campaigns`, `campaign_authors`, `workflows`, `workflow_prospects`, `email_templates`, `outreach_emails`** are referenced throughout `src/lib/db/queries.ts` but their `CREATE TABLE` DDL is **not** checked into `migrations/` or `scripts/` — they were provisioned directly in Supabase (or via migrations `002`/`003` that are absent from the repo). Their shape below is reconstructed from `src/lib/types.ts` plus the `ALTER TABLE` scripts that extend them.

#### Discovery / prospect tables (from `001_initial.sql`)

| Table | Stores | Key columns |
|---|---|---|
| `domains` | One row per publisher host | `host` (unique), `name`, `cms_guess`, `dr_proxy_score`, plus (later) `dr`, `dr_checked_at`, `organic_traffic`, `us_traffic_share`, `traffic_checked_at`, `metrics_source`, domain-qualification cols |
| `authors` | Discovered writers | `full_name`, `slug`, `avatar_url`, `bio`, `role`, `primary_domain_id`→domains, `same_as_json` (social profiles), `description` (AI-gen), `source`, `discarded`, `safety_score`, `safety_summary`, `safety_checked_at`; unique(`full_name`,`primary_domain_id`) |
| `articles` | Articles authored | `url_canonical` (unique), `title`, `excerpt`, `published_at`, `lastmod`, `lead_image_url`, `domain_id`, `archetype` (listicle/review/comparison/explainer/news), `readability_text_excerpt`, `source`, `safety_checked_at` |
| `article_authors` | Article↔author M:N | PK(`article_id`,`author_id`), cascade delete |
| `contacts` | Contact surfaces per author/domain | `type` (mailto/form/author_page/twitter/linkedin/mastodon/youtube/instagram), `value`, `confidence` (0–1), `source`, `verified_syntax`; unique(`author_id`,`type`,`value`) |
| `mentions` | Tool mentions per article | `article_id`, `tool_name`, `count`; unique(`article_id`,`tool_name`) |
| `links` | Outbound links per article | `target_url`, `anchor_text`; unique(`article_id`,`target_url`) — feeds link-gap analysis |
| `discovery_hits` | Raw discovery provenance | `url`, `source`, `query`, `title`, `snippet`, `processed`; unique(`url`,`source`); + `email_search_attempted` (script 017) |
| `scores` | Composite scoring per author×article | `relevance`, `freshness`, `authority`, `competitor_overlap`, `contact_confidence`, `composite`; unique(`author_id`,`article_id`) |
| `suppression` | Blocklist | `type` (domain/author/url), `value` (unique), `reason` |
| `seed_tools` | Tool/keyword catalog | `name` (unique), `aliases` (jsonb), `enabled`; seeded with 20 tools (imagineart + competitors) |
| `harvester_config` | Per-harvester on/off + config | `name` (unique), `enabled`, `config` (jsonb); seeds rss/gdelt/hackernews/reddit/wordpress/ghost/commoncrawl/wayback/brave |
| `pipeline_runs` | Discovery run log | `started_at`, `finished_at`, `stage`, `status` (running/completed/failed), `stats` (jsonb), `error` |

#### Content-governance & watch tables (script `013`)
| Table | Stores |
|---|---|
| `flagged_content` | One flagged post per author safety screen: `category` (nsfw/hate_violence_illegal/political_controversy), `severity` (low/medium/high), `reason`; unique(`article_id`) |
| `author_watches` | Per-user author subscriptions: PK(`user_email`,`author_id`), `last_checked_at` |
| `author_watch_notifications` | New-article alerts: `user_email`, `author_id`, `article_id`, `read_at`, `emailed_at`; unique(`user_email`,`article_id`) |

`013` also adds `authors.safety_score/safety_checked_at`, `articles.safety_checked_at`, and `campaigns.seed_writer_name/seed_article_url`.

#### Campaign / workflow / outreach tables
| Table | Stores | Key columns (from types + ALTERs) |
|---|---|---|
| `campaigns` | A discovery campaign | `name`, `keywords[]`, `region`, `target_hits`, `status` (draft/running/done), `seed_writer_name`, `seed_article_url`, `seed_domains[]`, `seed_article_urls[]` (script 029) |
| `campaign_authors` | Campaign↔author membership | join table used by `linkAuthorsToCampaign`/`getCampaignAuthorIds` |
| `workflows` | A filtered outreach set within a campaign | `campaign_id`, `name`, `filters` (jsonb `WorkflowFilters`), `status` (draft/running/ready) |
| `workflow_prospects` | Selected prospects per workflow | `workflow_id`, `author_id`, `included`, `rank` |
| `email_templates` | Outreach templates | `name`, `subject`, `body`, `guidance` (AI opener direction), `channel` (email/linkedin) (script 013 guidance/035 controls) |
| `linkedin_messages` | Generated LinkedIn connection notes (copy-paste, not sent) — script 012 | `workflow_id`, `author_id`, `template_id`, `body` |
| `outreach_emails` | Every outbound email + its whole thread state (the outreach + negotiation + payment anchor) | see below |

`outreach_emails` accumulates the most columns via ALTERs across scripts. Core (`types.ts`): `workflow_id`, `author_id`, `template_id`, `subject`, `body`, `status` (draft/ready/scheduled/sent/failed), `scheduled_at`, `sent_at`, `error`. Added later:
- **Sender attribution** (011/019): `sender_email`, `sent_by_email`
- **Threading / follow-ups** (026/027): `kind` (initial/followup/negotiation), `parent_id`→self, `followup_skipped`, `success_at`/`success_link`/`success_notes`
- **Reply detection** (018/028/030): `replied_at`, `reply_checked_at`, `reply_kind` (reply/bounce/auto), `reply_from`, `reply_subject`, `reply_excerpt`, `bounced_at`, `message_id`, `reply_sentiment`
- **Recipient override** (038): `recipient_override`
- **Negotiation** (033/034): `ai_managed`, `negotiation_status` (negotiating/agreed/declined/stalled/auto/blocked), `agreed_price`, `max_offer`, `negotiation_notes`
- **Payments** (036): `payment_status` (null/owed/requested/paid), `paid_at`, `payment_requested_at`, `paid_amount`

#### Sending / enrichment / inbox tables
| Table | Script | Stores |
|---|---|---|
| `email_send_config` | 006 | Per-workflow send schedule: `timezone`, `send_hour_start`(9)/`send_hour_end`(17), `gap_minutes`(15), `daily_cap`(50), `from_name/from_email`, `provider` (smtp/blitz); unique(`workflow_id`) |
| `user_email_config` | 011 | Per-teammate sending identity: `user_email` (PK), `app_password_enc` (encrypted Gmail app password), `from_name`, timezone/window/gap/cap |
| `enrichment_runs` | 009 | One Email-Finder run: `campaign_id/name`, `total`/`done`/`found`, `by_source` (jsonb), `people` (jsonb of per-person steps), timestamps |
| `learned_sources` | 004 | Auto-learned discovery sources: `type` (subreddit/domain/rss_feed), `value`, `score`, `times_seen`, `promoted`, `rejected`; unique(`type`,`value`) |
| `inbox_state` | 031 | Per-user thread read/dismiss: PK(`user_email`,`author_id`), `last_seen_at`, `dismissed` |
| `negotiation_settings` | 033/034/036 | **Singleton** (`id boolean PK = true`) negotiation handbook: `ai_autonomy` (master send toggle), `handbook`, `tone`, `max_thread_length`(4), `min_price`, `currency`, `anti_highball`, `pricing_rules` (jsonb DR/traffic→max-offer tiers), + `aggressiveness`/`opening_percent` |

#### Link Audit / Page Health tables
| Table | Script | Stores |
|---|---|---|
| `link_audit_runs` | 021 | Broken-link crawl run: `status`, `pages_total/checked`, `links_checked`, `broken_found`, `unreachable`, `slack_posted_at` |
| `link_audit_findings` | 021/022/023 | One broken link: `page_url`, `page_author`, `link_url`, `anchor_text`, `context_text`, `reason` (http-404/410/soft-404/homepage-redirect), `http_status`, location hints/occurrences; unique(`run_id`,`page_url`,`link_url`) |
| `indexing_runs` | 037 | Page-health scan: `target`, timing, `discovered`/`analyzed`, `templates_count`, `issues_count`, `p0_count`, `js_gated_count`, `playwright_enabled`, `pagespeed_key_present`, full `report` (jsonb) |
| `indexing_dispatches` | 037 | Actions taken on a run's findings: `kind` (pr/ticket/slack), `title`, `target_ref` (PR/ticket URL), `status` (ok/error) |

Shared-sender attribution tables (scripts 019/020) back `getSharedSenders`/`getEnabledSharedSenders` for admin-managed "send-as" identities.

---

### Scoring model

Composite 0–100 per prospect (`src/lib/score/index.ts`, `README.md`): **Relevance 35%** (tool-mention density + archetype bonus, e.g. listicle/comparison +15pts), **Competitor overlap 20%** (competitor tools mentioned without ImagineArt), **Authority 20%** (article count + cross-query presence), **Freshness 15%** (recency decay over 180 days), **Contact confidence 10%** (best contact surface found). A separate per-prospect **qualification** (`src/lib/score/qualify.ts`, `ProspectQualification` in `types.ts`) checks DR / organic traffic / US-traffic-share / relevance thresholds and produces pass/fail/unverified badges.

---

### Cron / QStash schedule

There are **two** schedulers; on any non-Vercel host only QStash matters (`DEPLOYMENT.md §5`, `docs/CRON_SETUP.md`).

**1. Upstash QStash (primary, host-independent)** — created by `scripts/setup-qstash.mjs <base-url>`. Two schedules, each POSTing an app endpoint with `Authorization: Bearer <CRON_SECRET>`:
- `*/30 * * * *` → **`POST /api/emails/process`** — sends due emails (batches of 25), runs the reply-detection sweep first, arms follow-ups, and drives the auto-negotiation loop. Timezone-accurate because it fires every 30 min.
- `0 8 * * *` (08:00 UTC) → **`POST /api/cron/daily`** — the fan-out cron.

**2. Vercel cron (`vercel.json`, Vercel-only backstop)** — a single `0 13 * * *` daily hit to `/api/emails/process`. Vercel Hobby allows only 1 run/day and 2 total cron jobs, so it is *not* sufficient for drip sending — QStash (or an external per-minute caller like cron-job.org) is the real timer. `vercel.json` also sets `git.deploymentEnabled:false` (deploys go through the `npm run vercel:*` prebuilt flow, not git push).

**The daily fan-out** (`src/app/api/cron/daily/route.ts`, `maxDuration=300`) authorizes via `CRON_SECRET` (Bearer or `?key=`) **or** a logged-in session, then self-`fetch`es (forwarding `?key=<secret>`):
1. `POST /api/link-audit/run` — broken-link audit (returns fast; continues via `after()`+QStash).
2. `POST /api/indexing/cron` — nightly Page Health scan (indexability + CWV), posts its own Slack digest.
3. `POST /api/digest/daily` — per-person ops digest email (only if the Settings toggle is on).
4. `POST /api/enrich/run` with `{only_new:true}` — daily email finding for authors never searched (avoids re-spending credits).
5. `after(() => POST /api/notifications/check)` — author-watch new-article notifications, run post-response.

Response is `{ ok, audit, pageHealth, digest, finder, notifications:"triggered" }`. `GET` proxies to `POST`.

---

### Concurrency, locks & long-job continuation

- **Redis locks** (`src/lib/redis.ts`): `lock:emails:process` (290s TTL) prevents overlapping send runs from double-sending; `discovery:lock` (330s TTL, refreshed by heartbeat) allows only one discovery run cross-instance; per-config `sendcount:<configId>:<day>` counters enforce daily caps durably (48h TTL). With no Redis (local dev), all lock helpers no-op and treat the single instance as owner.
- **QStash continuation** (`src/lib/qstash.ts`): `isServerless()` returns true only when `VERCEL==="1"`. On Vercel, long jobs (discovery, email finding) chunk into ≤~210s slices and self-continue by `qstashPublish()`-ing their own endpoint with the `CRON_SECRET` Bearer. On a persistent Node server they run to completion in one process via `after()`.

---

### Authentication & authorization

- **`auth.ts`** — NextAuth v5, single Google provider. `signIn` callback rejects any email whose domain is not in `ALLOWED_DOMAINS` (default `imagine.art`), redirecting to `/login?error=domain`. Session exposes `user.id` from the JWT `sub`. Custom pages: `signIn`/`error` → `/login`.
- **`src/proxy.ts`** (request middleware, matcher excludes `_next/*`, `favicon.ico`, `*.png`) — lets `/api/auth/*`, `/api/health`, and **CRON-secret-bearing** requests through unauthenticated; otherwise redirects logged-out users to `/login` and logged-in users away from `/login`.
- **Admin allowlist** (`src/lib/auth/admin.ts`) — `ADMIN_EMAILS` (default `abdullah.zubair@imagine.art`) gates powerful actions (send-as-teammate, DB wipe, shared-sender management). Domain sign-in gates the app; admin gates the dangerous subset.
- Cron/automation endpoints each **independently** re-validate `CRON_SECRET` (Bearer or `?key=`) or an app session — the proxy bypass alone does not authorize them.

---

### App shell & page map

`src/app/layout.tsx` wraps everything in `ThemeProvider` (dark default) + `SessionProvider`. When signed in it renders `Sidebar` (collapsible left nav), `TopNav`, and `KeyHealthBanner` (polls `/api/health/keys` and warns on any configured-but-failing API key), inside a `max-w-7xl` container; signed-out users see only the page (login). `RouteProgress` shows a top loading bar. Nav order is defined in `src/components/layout/Sidebar.tsx`.

| Route | File | What it's for |
|---|---|---|
| `/login` | `login/page.tsx` | Google sign-in; shows domain-rejection error |
| `/` (**Prospects**) | `page.tsx` | Main dashboard: scorecards, charts, ranked/filterable prospect list, prospect drawer, run-discovery entry, export |
| `/campaigns` | `campaigns/page.tsx` | Create/manage discovery campaigns (keywords, region, seed writer/domains/article URLs) and launch discovery per campaign |
| `/workflows` | `workflows/page.tsx` | Filter campaign prospects into an outreach workflow, pick a template, generate emails/LinkedIn notes, export |
| `/email-finder` | `email-finder/page.tsx` | Run/replay email + LinkedIn enrichment (Blitz/Hunter/Reoon cascade) over authors missing contacts; per-run activity view |
| `/emails` | `emails/page.tsx` | Review/edit generated outreach emails, toggle follow-ups, send-now, reschedule |
| `/sending` | `sending/page.tsx` | Sending control room: schedule status, per-sender caps, "Process now" trigger for `/api/emails/process` |
| `/inbox` | `inbox/page.tsx` | Per-person conversation view of detected replies (via IMAP); reply, dismiss, mark seen |
| `/negotiation` | `negotiation/page.tsx` | AI-negotiation threads: reply intent, suggested offer vs. ceiling, draft or auto-send next reply |
| `/payments` | `payments/page.tsx` | Payment tracker for agreed placements: owed → requested → paid on the negotiation anchor |
| `/handbook` | `handbook/page.tsx` | Editable negotiation handbook / singleton `negotiation_settings` (autonomy toggle, tone, min price, pricing tiers, anti-highball) |
| `/notifications` | `notifications/page.tsx` | Author-watch alerts (writers you follow publishing new articles); manage watches |
| `/link-audit` | `link-audit/page.tsx` | Link Audit + Page Health hub: broken-link crawler results and indexability/CWV scans, with PR/ticket/Slack dispatch |
| `/admin` | `admin/page.tsx` | Seed-tool editor, harvester toggles, suppression list, pipeline logs, shared senders, DB wipe (admin-gated) |
| `/settings` | `settings/page.tsx` | API-key health, per-user Gmail send config, Tavily key pool, daily-digest toggle |

The `/api/*` tree (~90 route files) exposes the server logic behind these pages — discovery/pipeline, prospects/authors, campaigns/workflows, email templates/generation/send/process/followups/reschedule, inbox/reply, negotiation, payments, enrich, link-audit, indexing (page health), notifications/watches, digest, health, and admin. Each area's routes are documented in their respective sections.

---

### End-to-end flows

**A. Discovery → prospect (`src/lib/pipeline/run.ts`)**
1. Acquire the cross-instance discovery lock and open a `pipeline_runs` row; set run meta in Redis for one continuous progress timer.
2. **Discover**: fan out enabled harvesters (GDELT, Hacker News, Reddit, RSS/sitemap over `config/seeds.ts` `SEED_DOMAINS`, WordPress, Ghost, Common Crawl, Wayback, plus optional Brave/Google-News/DuckDuckGo/ScrapeGraph/web-search) across archetype queries per enabled `seed_tools`; write `discovery_hits`.
3. **Canonicalize & filter**: normalize URLs, drop blocked/suppressed hosts.
4. **Fetch**: `fetchPage` (Playwright if enabled, else Cheerio static) for each unprofiled hit.
5. **Extract**: metadata (JSON-LD/OG via metascraper), readability text, tool mentions + outbound links, contacts, archetype, relevance, content safety.
6. **Persist**: upsert `domains`/`authors`/`articles`/`contacts`/`mentions`/`links`, link article↔author, insert `flagged_content`, recompute author safety score.
7. **Score**: `computeScore` → upsert `scores`. Link authors to the campaign; update campaign counts.
8. **Learn**: promote frequently-seen new subreddits/domains/feeds into `learned_sources`.
9. On Vercel, chunk + continue via QStash before the 300s limit (checkpoint saved); on a normal server, run to completion. Release lock, finish `pipeline_runs`.

**B. Outreach → send**
1. Create a campaign, run discovery, then build a `workflow` with filters (min score, archetype, tool, email status, not-contacted, region…).
2. Select `workflow_prospects`; run Email Finder to fill missing emails/LinkedIn.
3. Generate emails (AI opener from template `guidance` over prospect context) → `outreach_emails` (`status=ready`).
4. Schedule per `email_send_config`/`user_email_config` (timezone window + `gap_minutes` spacing + `daily_cap`) → `status=scheduled`, `scheduled_at` set.
5. Every 30 min `/api/emails/process` acquires the send lock, computes the UTC day bucket, and for each due email sends via the sender's own Gmail (decrypting `app_password_enc`), increments the Redis daily counter, sets `status=sent`/`sent_at`/`message_id`. Duplicate-recipient and cap guards skip rather than double-send.

**C. Reply detection → negotiation → payment**
1. Before each send loop, `/api/emails/process` runs a read-only IMAP sweep (`src/lib/email/imap.ts`/`inbox.ts`) that matches inbound messages to sent threads and sets `replied_at`, `reply_kind`, `reply_from/subject/excerpt`, `bounced_at`, `reply_sentiment`.
2. A due follow-up whose recipient has since replied is parked (`followup_skipped`).
3. For AI-managed threads, `negotiateThread` (`src/lib/negotiation/run.ts`) reconstructs the thread, classifies reply intent, computes the per-domain price ceiling from `negotiation_settings.pricing_rules` (DR + traffic tiers) capped by `outreach_emails.max_offer`, and drafts the next reply. If `ai_autonomy` is on and intent isn't `hard_no`/`unsubscribe`, it sends immediately via `deliverOutreach`; otherwise it persists a draft for human approval on the Negotiation page. Thread state → `negotiation_status`, `agreed_price`.
4. On agreement, the deal moves `payment_status` owed → requested → paid (with `paid_amount`, timestamps) on the negotiation anchor row, surfaced on `/payments`.

**D. Daily maintenance** — see the cron fan-out above (link audit, page health, digest, email finding, watch notifications).

---

### Deployment

**Two supported topologies** (`DEPLOYMENT.md`, `DEPLOY.md`, `Dockerfile`):

- **Vercel (current: `blog-lead.vercel.app`)** — serverless; `PLAYWRIGHT_ENABLED` unset so scraping falls back to static Cheerio fetch (~85% coverage per `README`). The 300s function limit forces long jobs to chunk and self-continue via QStash (`isServerless()` true). Deploys use the prebuilt CLI flow (`npm run vercel:build:prod` / `vercel:deploy:prod`); `git.deploymentEnabled:false`. Hobby cron is a once-daily backstop only, so QStash (or cron-job.org) drives real timing.
- **Persistent Node server / container (VPS, Render, Railway, Fly, Docker)** — recommended for full power. Background work runs to completion in one process (no chunking), and `PLAYWRIGHT_ENABLED=true` (after `npx playwright install --with-deps chromium`) unlocks JS-rendered scraping — the "local runner for Playwright" story: full-browser discovery runs on a real machine, while Vercel serves the UI on static fetch. **Requires `AUTH_TRUST_HOST=true`**, the new domain added as a Google OAuth redirect URI, `APP_URL`/`NEXTAUTH_URL` repointed, `AUTH_SECRET` kept identical (or stored Gmail passwords break), and QStash schedules repointed via `scripts/setup-qstash.mjs`. Avoid short-timeout serverless platforms other than Vercel — they'd kill mid-run jobs and aren't auto-detected.

**Local discovery runners**: `scratch_run.mjs` and `scripts/_disc_runner.mjs` import `runDiscoveryPipeline` directly against `.env.local`+`DATABASE_URL`, deleting `process.env.VERCEL` so jobs run uninterrupted; `_disc_runner.mjs` loops all `IA — %` campaigns with a checkpoint file (`/tmp/disc_done.txt`) and swallows transient socket errors so one bad request never kills the batch.

**Schema bootstrap** (only for a brand-new DB): run `migrations/001_initial.sql`, then every `scripts/0NN_*.mjs` in numeric order with `DATABASE_URL` set. Against the existing shared Supabase, all migrations are already applied.

---

### Edge cases & cautions

- **Secrets committed**: `.env.local` (real Supabase/OAuth/SMTP/enrichment/Upstash keys) is on disk and could be exposed; rotate if leaked. `DATABASE_URL` embeds the Postgres password.
- **Shared database**: the Supabase instance is shared with other projects — never drop/rename tables; migrations are additive by design.
- **RLS is effectively off for the app**: RLS is enabled but with an `allow_all` policy and no `FORCE`, and the app uses the service-role key — so RLS provides no isolation at runtime. Do not rely on it for tenant separation.
- **Missing repo DDL**: `campaigns`, `workflows`, `workflow_prospects`, `email_templates`, `outreach_emails`, `campaign_authors` have no checked-in `CREATE TABLE`. A fresh DB bootstrapped only from `001` + `scripts/` will be missing them (their `ALTER TABLE` scripts will fail). Provision them manually / from Supabase before running later migrations.
- **`AUTH_SECRET` is dual-purpose**: it also decrypts stored Gmail app passwords. Rotating it silently makes every saved sender password unreadable — sends then fail per-sender with no obvious cause.
- **Scheduler drift off Vercel**: repoint QStash to the new URL **and delete old schedules** pointing at the dead Vercel app, or both fire (double-sends / stale hits). `CRON_SECRET` must match on both ends or endpoints 401.
- **No Redis = weaker guarantees**: locks and daily-cap counters no-op without Upstash. Two concurrent send triggers on separate instances could double-send, and the daily cap then relies only on DB counts. Fine for single-instance local dev, risky in multi-instance prod without Redis.
- **Vercel + Playwright**: Playwright cannot run in Vercel serverless; leaving `PLAYWRIGHT_ENABLED` set there would break scraping instead of improving it. Keep it unset on Vercel.
- **Long-job death on wrong host**: a short-timeout serverless host that isn't Vercel won't be detected as serverless (`isServerless()` only checks `VERCEL`), so jobs won't chunk and will be killed mid-run ("discovery starts then dies"). Use a persistent process.
- **Cron auth bypass surface**: `src/proxy.ts` lets any request bearing the correct `CRON_SECRET` past the login wall for all matched paths (not just the intended endpoints); the individual routes must re-check the secret (they do). Treat `CRON_SECRET` as a real credential.
- **Reply detection is best-effort**: the IMAP sweep is read-only and its failures never block sending, so a transient IMAP outage can let a follow-up go out to someone who already replied. Matching depends on `message_id`/threading and can miss replies from a different address.
- **Negotiation autonomy is a live-send switch**: turning on `negotiation_settings.ai_autonomy` lets the LLM send real emails to real writers without human review (except `hard_no`/`unsubscribe`). Pricing ceilings come from DR/traffic tiers that may be `null`/unverified on the free plan, so a thread with no ceiling falls back to handbook defaults.
- **Vercel Hobby cron limits**: only 2 cron jobs and 1 run/day — the reason scheduling was moved onto QStash; the `vercel.json` daily cron alone cannot do timezone-accurate drip sending.

---

## Navigation, Authentication & Login

### Purpose

This area is the shell that wraps every authenticated page of GenAI Scout plus the gate that decides who gets in. Concretely it covers four things:

1. **Access control** — nobody can see any page except `/login` unless they have signed in with a Google account whose email domain is on the allowlist (default `imagine.art`). Enforced globally by `src/proxy.ts`.
2. **The app chrome** — a left **Sidebar** (primary navigation), a top bar (**TopNav**: breadcrumb, Tavily usage pill, theme toggle, user menu), a site-wide **KeyHealthBanner**, and a thin **RouteProgress** bar. All four are rendered by the root layout only when a session exists.
3. **A second, finer permission tier** — the **admin allowlist** (`ADMIN_EMAILS`, default `abdullah.zubair@imagine.art`), which unlocks "send as another teammate" and the shared-inbox picker. This is distinct from the domain gate.
4. **Operational visibility** — the key-health banner and Tavily pill surface failing API keys and search-quota exhaustion before they silently break the pipeline.

Stack note: Next.js 16.2.9, NextAuth v5 (`next-auth@^5.0.0-beta.31`, i.e. Auth.js), `next-themes` for dark/light. Sessions are JWT-based (no database adapter is configured).

---

### The root layout (composition)

File: `src/app/layout.tsx` (an async server component).

- Calls `const session = await auth()` (from `@auth`, i.e. `/auth.ts`) at the top.
- Wraps everything in `ThemeProvider` (`attribute="class"`, `defaultTheme="dark"`, `enableSystem`, `disableTransitionOnChange`) then `SessionProvider` (seeded with the server `session` so client hooks like `useSession` hydrate without a flash).
- **Every chrome element is conditionally rendered on `session?.user`:**
  - `{session?.user && <RouteProgress />}`
  - `{session?.user && <Sidebar />}`
  - `{session?.user && <TopNav />}`
  - `{session?.user && <KeyHealthBanner />}`
  - `<main>` with `children` always renders.
- Consequence: on `/login` (no session) the page renders bare — no sidebar, no top bar, no banner. This is intentional and matches the proxy allowing only `/login` when logged out.
- Font: `Poppins` bound to `--font-sans`. Global metadata title `"GenAI Scout — AI Writer Discovery"`. A `Toaster` (sonner, bottom-right) is always mounted.

---

### UI walkthrough

#### Sidebar — `src/components/layout/Sidebar.tsx` (primary navigation)

A `"use client"` fixed left rail. This is the real navigation of the app; every top-level route lives here.

**Nav items (the `NAV` array, in order) — each is a `next/link` to the given href:**

| Label | Href | Icon |
|---|---|---|
| Prospects | `/` | LayoutDashboard |
| Campaigns | `/campaigns` | Megaphone |
| Workflows | `/workflows` | GitBranch |
| Email Finder | `/email-finder` | AtSign |
| Emails | `/emails` | Mail |
| Sending | `/sending` | Send |
| Inbox | `/inbox` | Inbox |
| Negotiation | `/negotiation` | Bot |
| Payments | `/payments` | CreditCard |
| Handbook | `/handbook` | BookOpen |
| Notifications | `/notifications` | Bell |
| Link Audit | `/link-audit` | Unlink |
| Admin | `/admin` | Rocket |
| Settings | `/settings` | Settings |

- **Active state**: `pathname === item.href` gives the active link a highlighted background (`bg-sidebar-accent text-sidebar-accent-foreground`). Note this is an *exact* match — a nested route like `/emails/123` would not mark "Emails" active.
- **Collapse toggle**: a chevron button (top, next to the logo) flips `collapsed` state. Collapsed width `72px`, expanded `w-64`. When collapsed, labels hide and each link shows only its icon with a `title={item.name}` tooltip; the logo shrinks to just the violet search glyph.
- **Mobile**: below `lg`, a hamburger `Menu` button (fixed top-left, `z-50`) toggles `mobileOpen`. Opening shows a full-height drawer sliding in (`translate-x-0`) over a dark backdrop (`bg-black/50`); clicking the backdrop or any nav link closes it (`setMobileOpen(false)` on link click).
- **Per-link loading spinner** (`NavIcon`): uses Next.js 16's `useLinkStatus()` (imported from `next/link`) inside each `<Link>`. While that specific link's navigation is pending, its icon is swapped for a spinning `Loader2`. Must be rendered inside the `<Link>` because `useLinkStatus` reads link context.
- **Logo**: violet rounded square with a `Search` glyph + "GenAI Scout" wordmark, links to `/`.
- No auth logic lives here — the sidebar is only rendered when a session exists (layout gate), so it does not itself hide items per-role. Every user sees all 14 links, including **Admin** and **Settings** (the finer admin gating happens server-side, not by hiding the link — see Edge cases).

#### TopNav — `src/components/layout/TopNav.tsx`

A `"use client"` sticky top bar (`h-16`, `z-30`, backdrop blur). Left = breadcrumb, right = usage pill + theme toggle + user menu.

**Breadcrumb (left):**
- Always starts with a "GenAI Scout" link to `/`.
- Splits `usePathname()` on `/` and renders one crumb per segment, each a link to the cumulative path. Segment labels are humanized via the `PAGE_NAMES` map: `""`→"Prospects", `admin`→"Admin", `settings`→"Settings", `campaigns`→"Campaigns", `workflows`→"Workflows", `inbox`→"Inbox", `emails`→"Emails". Any segment not in the map is shown raw (capitalized via CSS). So e.g. `/email-finder` shows the raw slug "email-finder", and dynamic ids show as-is.

**Right side (in order):**

1. **Tavily usage pill** (`TavilyUsagePill`, see its own subsection below) — persistent search-quota indicator.
2. **Theme toggle** — a ghost icon button that flips `next-themes` between `"dark"` and `"light"` (`setTheme(theme === "dark" ? "light" : "dark")`). Sun/Moon icons cross-fade via CSS on the `dark` class. Screen-reader label "Toggle theme".
3. **User dropdown** — only rendered when `session?.user` exists (`useSession()`).
   - Trigger: an `Avatar` (`user.image` if present, else a violet fallback circle showing the uppercased first letter of `user.name`, then `user.email`, else `"U"`).
   - Menu content (`align="end"`, `w-56`):
     - A non-interactive label showing `user.name` and `user.email`.
     - **Settings** → sets `window.location.href = "/settings"` (a full navigation, not client-side `Link`).
     - **Admin panel** → `window.location.href = "/admin"`.
     - **Sign out** (styled destructive/red) → `signOut({ callbackUrl: "/login" })` — clears the NextAuth session and redirects to `/login`.

#### KeyHealthBanner — `src/components/layout/KeyHealthBanner.tsx`

A `"use client"` dismissible banner rendered under the TopNav. Warns when a configured API key is broken (red) or when something needs attention soon (amber, e.g. Tavily near quota).

- **Data source**: polls `GET /api/health/keys` on mount and then every **60 seconds**. Reads `data.broken` (hard failures) and `data.warnings` (amber advisories).
- **Visibility rule**: returns `null` (renders nothing) if `dismissed` is true OR if both `broken` and `warnings` are empty. So in the healthy case the banner is invisible.
- **Auto-un-dismiss**: whenever a poll returns any broken keys or warnings, `dismissed` is reset to `false` — so dismissing is per-issue-episode, and a newly appearing problem re-shows the banner even if you dismissed a previous one.
- **Tone**: red (`isError = broken.length > 0`) takes precedence; otherwise amber for warnings only.
- **Title text**: red → "An API key isn't working" (1) or "N API keys aren't working"; amber → "Heads up".
- **Detail text**: red → each broken key as `"{label} — {message}"` joined by " · "; amber → each warning as `"{label} — {message}"` joined by " · ".
- **Recheck button**: sets `rechecking`, calls `load(true)` which hits `/api/health/keys?force=1` (bypasses the 10-min server cache), then clears `rechecking`. Icon spins while in flight.
- **Dismiss button** (X): sets `dismissed = true`, hiding the banner until the next problem episode. Dismissal is **component-local state only** — it does not persist across reloads or navigations that remount the component.

#### RouteProgress — `src/components/layout/RouteProgress.tsx`

A thin (`h-0.5`) violet progress bar fixed at the very top (`z-[60]`), shown on every route change.

- Watches `usePathname()`. On the **first** render it does nothing (guarded by a `first` ref, so no flash on initial load).
- On subsequent path changes it becomes visible, animates width 0→100% over an 800ms keyframe (`route-bar`), then fades out after 800ms.
- Purely a cosmetic loading cue that overlaps a client page's own data-fetch/skeleton window; pairs with the sidebar link spinners. No data or auth logic.

#### Header — `src/components/layout/Header.tsx` (NOT WIRED IN — legacy/dead)

This component exists but is **imported by nothing** (verified: no import of `layout/Header` anywhere in `src/`). The live top bar is `TopNav`, not `Header`. `Header` is a slate-themed alternate top bar with a 3-item nav (`Prospects` `/`, `Admin` `/admin`, `Settings` `/settings`), a "BETA" badge, and a similar user dropdown (Settings / Admin panel / Sign out). Document it as a leftover — a maintainer editing navigation should edit `Sidebar.tsx`/`TopNav.tsx`, not this file.

#### Login page — `src/app/login/page.tsx`

A `"use client"` page. Centered card, no app chrome (layout suppresses chrome when no session).

- **Header block**: violet rounded square with a `Search` glyph, "GenAI Scout" title, subtitle "Writer discovery engine for generative AI outreach".
- **Card**: title "Sign in", description "Use your **@imagine.art** Google account".
- **Error banner** (conditional on a `?error=` query param, read via `useSearchParams()`):
  - `error === "domain"` → "Access restricted to **@imagine.art** accounts." and, if a `?email=` param is present, a sub-line "{email} is not allowed." (This is exactly the redirect the `signIn` callback produces for a rejected domain.)
  - any other `error` value → generic "Sign-in failed. Please try again."
- **Continue with Google** button → `signIn("google", { callbackUrl: "/" })`. On success the user lands on `/` (Prospects).
- Footer note: "Internal tool — imagine.art accounts only".
- The whole thing is wrapped in `<Suspense>` (fallback = blank background) because `useSearchParams()` requires a suspense boundary. `LoginPage` (default export) renders `<Suspense><LoginContent/></Suspense>`.

---

### Authentication configuration — `auth.ts`

The NextAuth v5 instance, exported as `{ handlers, signIn, signOut, auth }` and aliased `@auth` (tsconfig path `"@auth": ["./auth"]`).

- **Provider**: Google only, using `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars (asserted non-null with `!`).
- **`ALLOWED_DOMAIN`**: `process.env.ALLOWED_DOMAINS ?? "imagine.art"`. Comma-separated list of allowed domains.
- **`signIn` callback** (the domain gate):
  1. `email = user.email ?? ""`.
  2. `allowed = ALLOWED_DOMAIN.split(",").map(trim)`.
  3. `domain = email.split("@")[1]`.
  4. If `domain` is not in `allowed`, returns the string `` `/login?error=domain&email=${encodeURIComponent(email)}` `` — NextAuth treats a returned URL as a redirect, so the user bounces back to the login page with the error banner shown.
  5. Otherwise returns `true` (sign-in permitted).
- **`session` callback**: copies `token.sub` onto `session.user.id` (cast `as any`) so the user id is available client-side. (No DB lookup — this is JWT-derived.)
- **`pages`**: `signIn: "/login"`, `error: "/login"` — both auth flows route through the custom login page.
- **Session strategy**: JWT by default (no adapter configured). The session lives in an encrypted cookie signed with `AUTH_SECRET`. `NEXTAUTH_URL` is set for callback URL resolution.

**Route handler**: `src/app/api/auth/[...nextauth]/route.ts` is trivially `export const { GET, POST } = handlers;` — the NextAuth catch-all that serves `/api/auth/*` (sign-in, callback, session, sign-out, csrf, providers).

---

### The proxy (global middleware) — `src/proxy.ts`

This is Next.js 16's middleware equivalent, named `proxy` (not `middleware`). It runs on nearly every request and is the enforcement point for the login gate.

**Function `proxy(req)`:**
1. Computes flags from the path:
   - `isApiAuth` = path starts with `/api/auth`.
   - `isHealth` = path is **exactly** `/api/health` (note: NOT `/api/health/keys` — that sub-route is *not* exempt).
   - `isLoginPage` = path is exactly `/login`.
2. **Cron/automation bypass**: if `CRON_SECRET` is set AND the request carries either `Authorization: Bearer <CRON_SECRET>` or `?key=<CRON_SECRET>`, `isCron` is true. This lets Vercel cron / Upstash QStash hit the send-processor without a session cookie (the target route re-validates the secret itself).
3. **Bypass**: `if (isApiAuth || isHealth || isCron) return NextResponse.next()` — these skip the auth check entirely.
4. Otherwise calls `await auth()` → `isLoggedIn = !!session`.
5. **Redirects**:
   - If on `/login` **and** logged in → redirect to `/` (don't show login to an authed user).
   - If **not** logged in **and** not on `/login` → redirect to `/login`.
   - Else `NextResponse.next()`.
6. **Matcher** (`config.matcher`): `["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"]` — runs on everything except Next static assets, the image optimizer, `favicon.ico`, and any path ending in `.png`.

**Implications:**
- All app pages and all API routes (except `/api/auth/*`, exactly `/api/health`, and cron-authenticated calls) require a valid session, or the request is redirected (HTTP 307) to `/login`.
- Because the guard redirects rather than 401s, an unauthenticated **API** call returns a redirect to `/login` (an HTML page), not a JSON 401. Client fetches that don't follow-then-parse can see confusing results — worth knowing when debugging.
- `.png` files bypass auth (public assets); other image types are not explicitly exempted but `_next/image` (the optimizer) is.

---

### The admin allowlist — `src/lib/auth/admin.ts`

A **second, finer** permission tier layered on top of the domain gate. The whole app is gated to the `imagine.art` domain by sign-in; "admin" is a smaller set allowed to do powerful things (chiefly: send email *as* another teammate).

- **`getAdminEmails()`**: reads `process.env.ADMIN_EMAILS?.trim() || "abdullah.zubair@imagine.art"`, splits on comma, trims, **lowercases**, filters empties. Note the `|| ` fallback (unlike auth.ts's `??`) so an empty string *does* fall back to the default.
- **`isAdminEmail(email?)`**: `false` for null/empty; otherwise `getAdminEmails().includes(email.toLowerCase())`. Case-insensitive.

**What admin actually unlocks (exhaustively — only two enforcement points use `isAdminEmail`):**

1. **`GET /api/inbox-accounts`** (`src/app/api/inbox-accounts/route.ts`): returns the list of team mailboxes that have a connected Gmail app password. **Non-admins get `[]`**, so the "Send from" picker on the Emails page collapses to just "Your own email" for them. (Admins see all shared inboxes.)
2. **`POST /api/workflows/[id]/send`** (`src/app/api/workflows/[id]/send/route.ts`): the "send as another teammate" path. If the request body's `sender_email` differs from the caller's own email, the route requires `isAdminEmail(authEmail)` — else it returns **403 "Only an admin can send as another user."** Admins can act-as: the email sends from the chosen account's Gmail and is attributed to them (`sent_by = them`).

**What admin does NOT gate (important):** The **Admin page itself (`/admin`) is not admin-gated** — it's a client page reachable by any signed-in user (the sidebar link and the user-menu "Admin panel" item are shown to everyone). Its backing API routes are likewise only login-gated, not admin-gated:
- `POST/DELETE /api/admin/tavily-key` and `GET` — add/remove/list Tavily pool keys: **no `isAdminEmail` check** (relies solely on the proxy login gate).
- `GET/POST /api/admin/shared-senders` and `PATCH .../[email]` — manage shared inboxes / passwords: **no `isAdminEmail` check**.
- `POST /api/admin/wipe` — deletes all prospect data (scores, mentions, links, contacts, article_authors, articles, authors, domains, discovery_hits): only checks `session?.user` (any logged-in `imagine.art` user), **not** `isAdminEmail`. See Edge cases.

---

### The Tavily usage pill — `TavilyUsagePill` (in `TopNav.tsx`) + `src/lib/search/tavilyUsage.ts`

A persistent badge in the top bar that surfaces this month's Tavily search-API usage against the whole key pool's capacity, so quota creep is always visible.

**Pill component (`TopNav.tsx`):**
- Fetches `GET /api/health/keys` on mount and every **30 seconds**, taking `data.tavily` (a `TavilyUsage` object).
- Renders `null` if `!usage?.enabled` (no Tavily key wired at all).
- **Capacity** shown = `usage.limit` directly (this is already the aggregate = active pool keys × per-key limit; the code comment warns against multiplying again).
- **Label**: a `Search` icon + `used / capacity` (e.g. `1,234/4,000`). If there is a pool (`poolTotal > 0`), it appends `· {poolActive}/{poolTotal} keys`.
- **Tone**:
  - red if `usage.over` (no capacity left),
  - amber if (pool exists → `poolActive <= 1`; else `usage.near`),
  - muted otherwise.
- **Tooltip** (title attr): with a pool → "{used} Tavily searches this month · {active}/{total} keys active (capacity ~{capacity}/mo)"; without → "Tavily search API usage this month".

**Backing logic (`getTavilyUsage()` in `tavilyUsage.ts`)** — how the numbers are computed:
- Tavily has no usage API, so calls are counted in Redis per calendar month. `PER_KEY_LIMIT = TAVILY_MONTHLY_LIMIT || 1000` (free tier = 1000/mo per key).
- A **rotating key pool** is stored in Redis (`tavily:pool`), keys encrypted at rest. Each search uses the *least-used non-exhausted* key (`getActiveTavilyKey`), balancing load. A key hitting quota (429/402/432/403) is flagged `exhaustedMonth` and dropped until the month rolls over.
- Falls back to a legacy single-key override (`tavily:key_override`) then the `TAVILY_API_KEY` env var when the pool is empty.
- `enabled` = env key set OR pool non-empty.
- Global monthly tally in `tavily:count:<YYYY-MM>`; per-key tallies in `tavily:count:<YYYY-MM>:<id>`.
- **`limit`** (aggregate capacity) = `(pool ? max(poolActive,0) : 1) * PER_KEY_LIMIT`.
- **`over`** = pool ? `poolActive === 0` : `used >= limit`.
- **`near`** = pool ? `poolActive <= 1 && !over` : `used >= limit*0.9`.
- If Redis is unavailable it returns `used: 0` with `error: null` (best-effort — the pill still renders capacity but shows 0 used).

---

### API routes / server logic

#### `GET /api/health` — public liveness/uptime probe
File: `src/app/api/health/route.ts`. **No auth** (exempted by the proxy's exact `=== "/api/health"` check).
- Checks Supabase connectivity (`domains` select limit 1) → `checks.supabase` = "ok" or `error: ...`.
- Reports config-only flags (no live calls): `checks.llm` ("configured" if `OPENROUTER_API_KEY` else "not configured (using templates)"), `checks.playwright` (`PLAYWRIGHT_ENABLED === "true"` ? "enabled" : "disabled"), `checks.brave` (`BRAVE_SEARCH_API_KEY` ? "configured" : "not configured").
- **Responses**: `200` with `{status:"ok", version:"1.0.0", timestamp, checks}` when Supabase is "ok"; otherwise **`503`** with `status:"degraded"`.

#### `GET /api/health/keys` — key health + Tavily usage (powers banner + pill)
File: `src/app/api/health/keys/route.ts`. **Login-gated** (NOT exempted — only exact `/api/health` is). Query `?force=1` bypasses the 10-min cache.
- Runs `checkAllKeys(force)` and `getTavilyUsage()` in parallel.
- `broken` = configured keys that are `!ok` and not in `SUPPRESSED = {reoon, hunter}` (those two are checked/listed but never alerted on).
- `warnings` (amber): pushes a "Tavily search" warning when `tavily.enabled` and (`over` OR `error` OR (pool ? `poolActive <= 1` : `near`)). Message text varies: key error detail; with a pool → "all N Tavily keys are out…" / "only M of N Tavily keys left…"; without a pool → "monthly quota used up (used/limit)…" / "nearly out (used/limit)…". All suffixed "— add …keys in Settings".
- **Response** (`200`): `{ keys, broken, warnings, tavily, healthy }` where `healthy = broken.length===0 && warnings.length===0`.

#### Key checker library — `src/lib/health/keys.ts`
`checkAllKeys(force=false)` runs all checkers in parallel with a **10-minute in-process cache** (`TTL_MS`) keyed per service; `force` bypasses the cache. Results sorted to stable order `[smtp, reoon, hunter, blitz, openrouter]`. Each checker returns `{service, label, configured, ok, message, checkedAt}`; an unconfigured key returns `configured:false, ok:true` (so it never alerts). Checkers:
- **Hunter** (`checkHunter`): `GET api.hunter.io/v2/account` (8s timeout). 401 → invalid; non-ok → `HTTP <status>`; parses remaining searches, ≤0 → "Monthly search quota exhausted"; else "N searches left this month".
- **Reoon** (`checkReoon`): quick-mode verify of `health@example.com` (10s). `status:"error"` or non-ok → error reason; missing status → `HTTP <status>`; else OK.
- **Blitz** (`checkBlitz`): `GET api.blitz-api.ai/v2/account/key-info` with `x-api-key` (8s). Non-ok → `HTTP <status>`; `!valid` → "Key reported invalid"; else "OK (N credits)".
- **OpenRouter** (`checkOpenRouter`): `GET openrouter.ai/api/v1/key` Bearer (8s). 401 → invalid; non-ok → `HTTP <status>`; else OK.
- **SMTP** (`checkSmtp`): if `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` all set, runs `verifyTransport()` (10s timeout). Timeout → "Verify timed out"; else OK / the verify error.
- On any thrown error each checker returns `ok:false, message:"Unreachable"`.

#### `GET /api/inbox-accounts` — shared-inbox list (admin-gated)
File: `src/app/api/inbox-accounts/route.ts`.
- `session = await auth().catch(() => null)`; `email = session?.user?.email`.
- No email → **`401` `[]`**.
- Not `isAdminEmail(email)` → **`200` `[]`** (empty, so the picker shows only "your own email").
- Admin → `200` with `getInboxAccounts()` = rows from `user_email_config` that have a non-null `app_password_enc`, mapped to `{ email, label }` (label = `from_name` || `shared_sender_label` || the email). Source: `src/lib/db/queries.ts` `getInboxAccounts()`.

#### `POST /api/workflows/[id]/send` (auth-relevant portion only)
File: `src/app/api/workflows/[id]/send/route.ts`. See "admin allowlist" above. Body `{ sender_email? }`. No `authEmail` → **`401` "not signed in"**. Choosing a different `sender_email` requires admin (else **`403`**); the chosen account must have a connected app password (else **`400`** "That account can't be sent from…"). Own-email sends need no admin.

#### Admin API routes (login-gated only, NOT admin-gated)
- `GET/POST/DELETE /api/admin/tavily-key`: list/add/remove Tavily pool keys (masked on read). POST accepts `{key,label?}` or `{keys:"a\nb"}`, splits on whitespace/comma; empty → **`400` "key required"**; add error → **`500`**.
- `GET/POST /api/admin/shared-senders` and `PATCH /api/admin/shared-senders/[email]`: manage shared inboxes and app passwords.
- `POST /api/admin/wipe`: only `session?.user` check → **`401`** if not logged in; otherwise deletes all prospect tables in FK order and returns `{ok:true, results}`.

---

### Key checks & validations

- **Domain allowlist** (`auth.ts signIn`): membership of `email.split("@")[1]` in the (default `imagine.art`) list; failure redirects to `/login?error=domain&email=…`.
- **Session presence** (`proxy.ts`): `!!(await auth())` gates all non-exempt routes.
- **Cron secret** (`proxy.ts`): constant-string comparison of Bearer header / `?key=` to `CRON_SECRET` (only if the env var is set).
- **Admin allowlist** (`isAdminEmail`): case-insensitive membership check; enforced only in `/api/inbox-accounts` and the send route's act-as branch.
- **App-password presence**: `getInboxAccounts` only returns mailboxes with `app_password_enc != null`; the send route re-checks the chosen account exists in that list.
- **Key-health gating**: only `configured && !ok` keys become "broken"; `reoon`/`hunter` are suppressed from alerts; Tavily warnings are pool-aware.

---

### Flows

**1. First-time sign-in (allowed domain)**
1. Unauthenticated user hits any path → proxy redirects to `/login`.
2. Clicks "Continue with Google" → `signIn("google", {callbackUrl:"/"})`.
3. Google OAuth completes; NextAuth `signIn` callback checks the email domain.
4. Domain is `imagine.art` → returns `true`; JWT session cookie is set; redirect to `/`.
5. Root layout now sees a session → renders Sidebar, TopNav, KeyHealthBanner, RouteProgress.

**2. Sign-in rejected (wrong domain)**
1. Same up to the Google callback.
2. `signIn` callback finds the domain not in the allowlist → returns `/login?error=domain&email=<email>`.
3. Browser lands on `/login`; the page reads `?error=domain` and shows "Access restricted to @imagine.art accounts. {email} is not allowed."

**3. Signed-in user visits `/login`**
1. Proxy sees `isLoginPage && isLoggedIn` → redirects to `/` immediately.

**4. Sign-out**
1. User menu → "Sign out" → `signOut({callbackUrl:"/login"})` clears the cookie and navigates to `/login`.
2. Layout no longer has a session → chrome disappears.

**5. Key-health banner lifecycle**
1. Banner mounts (only when logged in), polls `/api/health/keys` immediately then every 60s.
2. If broken keys / warnings appear, banner shows (red or amber) with detail; `dismissed` is force-reset so it can't stay hidden through a new problem.
3. User clicks Recheck → force refetch (`?force=1`) bypassing the 10-min cache. User clicks X → hidden until the next problem episode.

**6. Tavily pill lifecycle**
1. Pill mounts (logged in), polls `/api/health/keys` immediately then every 30s, reads `data.tavily`.
2. Hidden if Tavily not enabled; else shows `used/capacity` and `active/total keys`, tinted red (over) / amber (over-90% or pool down to last key) / muted.

**7. Admin sends "as" a teammate (from Emails page)**
1. Emails page fetches `/api/inbox-accounts`; admin gets the list, non-admin gets `[]`.
2. "Send from" dialog: option "Your own email" plus one option per shared inbox (excluding the caller's own address).
3. Choosing a shared inbox → `POST /api/workflows/[id]/send` with `{sender_email}`.
4. Server requires admin (else 403) and that the account has an app password (else 400); on success sends from that Gmail attributed to that person.

---

### Edge cases & cautions

- **`ALLOWED_DOMAINS` uses `??`, not `||`.** `process.env.ALLOWED_DOMAINS ?? "imagine.art"` only falls back on `null`/`undefined`. If the env var is present **but empty** (`ALLOWED_DOMAINS=`), `ALLOWED_DOMAIN` becomes `""`, `"".split(",")` = `[""]`, and **every sign-in is rejected** (no real domain matches). Contrast `admin.ts`, which correctly uses `|| ` so an empty value falls back. A maintainer must set a real value or leave the var unset entirely — an empty string locks everyone out. (`.env.local` in this checkout shows `ALLOWED_DOMAINS=` present; confirm it is actually populated in each environment.)
- **The Admin page is not admin-gated.** `/admin` and its key-management / shared-sender / wipe APIs are protected only by the login gate (any `imagine.art` user), not by `ADMIN_EMAILS`. The `isAdminEmail` allowlist only affects the shared-inbox *list* and the *send-as* action. So any signed-in teammate can add/remove Tavily keys, manage shared-sender app passwords, and — critically — **wipe all prospect data via `POST /api/admin/wipe`** (which only checks `session?.user`). If tighter control is intended, these routes need an `isAdminEmail` check added.
- **`/api/admin/wipe` is destructive and lightly guarded.** It hard-deletes nine tables and is reachable by any logged-in user. Individual table failures are only `console.warn`-ed (not surfaced), and it still returns `{ok:true}` with per-table booleans — a partial failure can look successful at a glance.
- **`/api/health/keys` is login-gated, `/api/health` is not.** The proxy exempts only the exact string `/api/health`. Anything mistaking the sub-route for public will get a redirect to `/login` when unauthenticated.
- **API auth failures are redirects, not 401s.** For non-exempt API routes, the proxy issues a 307 redirect to `/login` (HTML) rather than a JSON 401. A fetch expecting JSON may silently mis-parse.
- **Cron bypass is a plaintext secret.** Any request with the right `Authorization: Bearer <CRON_SECRET>` or `?key=<CRON_SECRET>` skips the login gate for all matched routes. If `CRON_SECRET` is unset, `isCron` is always false (bypass disabled) — but then legitimate cron/QStash calls will be redirected to `/login`.
- **Active-state is exact-match.** Both Sidebar and Header mark a link active only when `pathname === href`. On nested routes (`/emails/123`, `/workflows/abc`) no top-level item highlights. Breadcrumb humanization also only covers the `PAGE_NAMES` set — other segments (e.g. `email-finder`, dynamic ids) render raw.
- **Dead component.** `Header.tsx` is not imported anywhere; edits to it have no effect. Navigation changes belong in `Sidebar.tsx` (main nav) and `TopNav.tsx` (top bar).
- **User-menu links use `window.location.href`.** The "Settings"/"Admin panel" items trigger full-page navigations (not client-side `Link`), so they lose SPA state and re-run the whole layout.
- **Banner dismissal is ephemeral.** Dismiss state is component-local React state — a reload, or any remount, brings the banner back if the problem persists. There is no persistent "snooze".
- **Tavily numbers depend on Redis.** With no Redis configured, `getTavilyUsage` returns `used:0` (capacity still computed), so the pill/banner can under-report real usage. Per-key counting is best-effort/fire-and-forget and can drift under heavy concurrency (mitigated by the `reserve` increment in `getActiveTavilyKey`).
- **Key-health cache lag.** Results are cached 10 minutes in-process; a key that just broke (or recovered) won't reflect until the cache expires or someone clicks Recheck (`?force=1`). Also, the cache is per-process — in a multi-instance deployment each instance caches independently.
- **`reoon`/`hunter` failures never alert.** They are in `SUPPRESSED`, so a broken Hunter or Reoon key shows in the raw `keys` list but never turns the banner red. Intentional, but a silent-failure risk for those two services.
- **Session id is JWT-derived, not verified against a DB.** `session.user.id = token.sub`; there is no adapter/database check, so the id reflects whatever the JWT carries.

---

## Discovery Pipeline (Dashboard / Home)

### Purpose

The Discovery Pipeline is the engine that populates GenAI Scout with prospects. It is a
multi-stage crawler that finds editorial writers who cover generative-AI tools, profiles them
into author records, scores each one for outreach value, and (optionally) links the results to
a campaign. The home page (`/`, `src/app/page.tsx`) is the single-screen control surface for
this: it shows the discovered prospects, the analytics that summarize the pool, and the live
pipeline runner with progress, history, and destructive maintenance actions.

Plain-language stage flow:

1. **Seeds** — load the target tools/topics (seed list) and which harvester sources are turned on.
2. **Harvest** — run every enabled source (GDELT, Hacker News, Reddit, RSS/sitemaps, WordPress,
   Google News, DuckDuckGo, real web-search API, ScrapeGraph, Brave) against generated search
   queries, plus a one-time RSS crawl of curated + learned domains. Raw article URLs land in the
   `discovery_hits` table.
3. **Extract** — for each hit: fetch the page, pull metadata (title/author/date/publisher),
   readable text, mentions of tracked tools, contacts (social/email/contact-form), classify the
   article archetype, LLM-score its topical relevance, and LLM-screen its content safety.
4. **Score / qualify** — compute a composite 0-100 score per author from relevance, freshness,
   authority, competitor overlap and contact confidence. (Qualification — DR≥50 etc. — is a
   separate read-time filter in `src/lib/score/qualify.ts`.)
5. **Authors** — a scored `authors` row becomes a "prospect" surfaced on the dashboard.
6. **Learn** — after processing, mine the run for new subreddits and productive publisher
   domains and auto-promote them so the next run's source set self-expands.

The whole run is **fire-and-forget and globally singleton**: it runs server-side via Next's
`after()` so closing the browser tab never stops it, only one discovery can run at a time across
all users/instances, and long runs auto-continue across serverless time limits via QStash.

---

### UI walkthrough — `src/app/page.tsx` (`HomePage`)

The page is a client component (`"use client"`). It is titled **"Prospects"** and is organized
as three tabs plus a persistent header. A thin violet **global loading bar** is fixed to the top
of the viewport whenever `loading` is true (any prospect fetch in flight; lines 414-420).

#### Page header (always visible, lines 422-485)

- **Title** — `Prospects` (h1).
- **Export CSV** button (outline, `Download` icon) — calls `handleExport("csv")`, which opens
  `/api/export?format=csv&…` in a new tab, carrying the current `archetype`, `minScore`, and
  `tool` filters (NOT search/campaign/email filters), and toasts "Exporting CSV…".
- **Discovery-campaign `<select>`** — only rendered when `campaigns.length > 0`. Options: "No
  campaign" plus every campaign name. Sets `discoveryCampaignId` (the campaign the NEXT discovery
  run harvests for). Disabled while `isDiscovering`. Title tooltip: "Campaign to discover for".
- **Resume button** (amber outline, `RefreshCw`) — only shown when a `resumableCheckpoint` exists
  AND no run is active. Label: `Resume (round N)`. Tooltip shows the round and how many queries
  are already done. Calls `runDiscovery(true)`.
- **Run Discovery** button (violet, `Rocket`) — calls `runDiscovery(false)`. Disabled while
  `isDiscovering`; when discovering it shows a spinning `RefreshCw` and "Discovering…".
- **Keyword chip row** (lines 471-485) — if a discovery campaign is selected, shows
  `Keywords for "<name>":` followed by a `Badge` per keyword, or the italic "no keywords set".

#### Tabs (`TabsList`, lines 487-507)

Three triggers in a 3-column grid:

- **Overview** — analytics.
- **Prospects** — while loading on this tab shows a spinner; otherwise a `Badge` with the total
  count (`total.toLocaleString()`) when `total > 0`.
- **Pipeline** — shows a pulsing violet dot while `isDiscovering`.

`activeTab` is state; several actions programmatically switch tabs (e.g. running discovery jumps
to "pipeline"; adding a prospect jumps to "prospects").

#### Overview tab (lines 509-530)

Renders analytics fed by the same `/api/prospects?include=stats,charts` call:

- **`Scorecards`** (`src/components/dashboard/Scorecards.tsx`) — five stat cards built from
  `DashboardStats`: **Total Prospects** (= total authors), **Authors** (unique writers),
  **Publications** (distinct domains), **Contactable** (`contactablePercent`% "have email or
  social"), **New This Week** (authors created in last 7 days). Each shows an icon, value,
  description, and an "Active" trend chip when its value is above zero (Contactable's chip needs
  >50%). Has a skeleton state (`loading` prop = `loading && stats.totalProspects === 0`).
- **`CompetitorHeatmap`** (`Charts.tsx`) — bar chart "Tool Mention Frequency", top 12 of
  `toolCounts` (`getToolMentionCounts` counts rows in `mentions` per `tool_name`, top 20). Empty
  state "No data yet / Run discovery to populate".
- **`FreshnessTimeline`** — area chart "Article Freshness", `timeline` = per-day article counts
  by `published_at`, last 90 days (`getFreshnessTimeline`).
- **`TopPublications`** — ranked bar list "Top Publications", top 8 of `publications`
  (`getTopPublications`: domains with author count + avg composite score).
- **`ProvenanceChart`** — donut "Source Provenance", `provenance` = processed `discovery_hits`
  grouped by `source` (`getSourceProvenance`).

All charts render an `EmptyChart` placeholder when their data array is empty.

#### Prospects tab (lines 532-732)

A filter `Card` then a responsive grid of `ProspectCardComp` cards. Filter controls (each change
re-fetches from `/api/prospects` and resets to offset 0 via the effect on lines 210-214):

- **Search** input (`search`) — free text over authors/publications. Shows a tiny spinner in the
  label while loading.
- **Article type** select (`archetype`) — All / Listicle / Comparison / Review / Explainer / News.
- **AI tool covered** select (`selectedTool`) — "Any tool" plus the top 15 tool names from
  `toolCounts` (`topTools`).
- **Min score** select (`minScore`) — Any / 20+ / 30+ / 50+ / 70+ (top).
- **Email** select (`emailStatus`) — Any / Has email / Found-or-sourced (`verified`) / Guessed
  (pattern) / No email / Has LinkedIn, no email.
- **Sort by** select (`sortBy`) — Score (`composite`) / Relevance / Authority / Most recent
  (`freshness`).
- **Has contact** switch (`hasContact`).
- **Qualified only** switch (`qualifiedOnly`) — sends `qualified_only=true` (DR≥50 + relevant).
- **Campaign** filter `<select>` (`filterCampaignId`, only if campaigns exist) — "All authors"
  plus each campaign; filters the displayed pool by campaign membership.
- **Add Prospect** button (`UserPlus`) — opens the Add-Prospect dialog (below). `ml-auto` pushes
  it right.
- **JSON** button — `handleExport("json")`.

Below the filters, four render states:

1. **Skeleton** (`loading && prospects.length === 0`) — 8 skeleton cards.
2. **Dimmed overlay** (`loading && prospects.length > 0`) — existing cards at 40% opacity with a
   centered "Updating results…" pill.
3. **`EmptyState`** (`prospects.length === 0`, not loading) — "No prospects yet" with a "Run your
   first discovery" button that switches to the pipeline tab and starts a run.
4. **Card grid** — one `ProspectCardComp` per prospect; clicking opens `ProspectDrawer`. A **Load
   more** button appears when `prospects.length < total`, incrementing `offset` by `limit` (24);
   the offset effect appends the next page.

##### Add-Prospect dialog (lines 925-991)

`Dialog` titled "Add prospect". Fields: **Full name** (required), **Email** (optional),
**Article links** (repeatable `Input` rows; ≥1 `https?://` link required; "Add another link"
appends a row, per-row remove `XCircle` when >1), **Publication / website** (optional, overrides
inferred domain), and **Campaign** `<select>` (if campaigns exist). Submit is disabled unless a
name is present and at least one valid URL exists. `submitAddProspect` posts to
`/api/prospects/manual`; on success it toasts, closes, switches to the Prospects tab, clears the
campaign filter, and sets `search` to the new name so the just-added prospect is visible (it
sorts by score and otherwise wouldn't be on page 1). On failure it toasts the error.

#### Pipeline tab (lines 734-919)

- **Header** — "Discovery Pipeline" with subtitle listing sources. A **Run Discovery / Run
  Again** button on the right (hidden while `isDiscovering`); the label becomes "Run Again" once
  events exist or a run is live.
- **Live pipeline card** (lines 752-781) — rendered when `pipelineEvents.length > 0 ||
  isDiscovering || isReconnected`. Contains:
  - A violet "Running discovery for <campaign name or 'All prospects (no campaign)'>" banner
    while live.
  - An amber "Reconnected after page refresh — replaying events from server buffer · polling
    every 4s" banner when `isReconnected`.
  - The **`PipelineProgress`** component (detailed below).
- **Empty state** (lines 784-799) — when no run and no events: a `Rocket`, "Ready to discover",
  and a "Start Discovery" button.
- **Profile New Articles** card (lines 801-828) — only when a discovery campaign is selected AND
  `savedHitCounts.unprofiled > 0` AND not discovering. Explains N saved hits never profiled; a
  "Profile (N left)" button calls `runReprocess()` (SSE reprocess of unprofiled hits, linked to
  the selected campaign).
- **Danger zone / Wipe Database** card (lines 830-851) — destructive. "Wipe & Start Fresh"
  button calls `wipeAndReset` (native `confirm()` first). Disabled while wiping or discovering.
- **Run History** (lines 853-918) — only if `runHistory.length > 0`. Lists the last 20
  `pipeline_runs` (from `GET /api/pipeline`): a status dot (emerald completed / red failed /
  pulsing amber running), start time + duration, stat pills (hits / processed / authors / errors
  from `run.stats`), and an uppercase status label. Duration is computed from
  `finished_at - started_at` (or now if still running).

#### `PipelineProgress` component (`src/components/pipeline/PipelineProgress.tsx`)

Purely presentational — it derives everything from the `events` array plus a few flags. Props:
`events`, `isRunning`, `isDone`, `isError`, `isStopping`, `stats`, `onStop`, `onRestart`,
`elapsedMs`.

- **Header row** — status icon (spinner running / amber spinner stopping / emerald check done /
  red X error), the current stage label (`STAGE_LABELS`: discover→"Setting up harvesters",
  harvester→"Harvesting sources", process→"Profiling authors", learn→"Learning from run",
  complete→"Complete", stopped, error, idle→"Ready"), and when processing, a live
  "X / Y articles (Z%)" readout. Sub-line shows elapsed time and, during processing, an
  articles/min rate + ETA.
- **Stop / Run Again buttons** — Stop shows while running and not stopping (calls `onStop`); Run
  Again shows when done/error/stopped (calls `onRestart`).
- **Overall stage progress bar** — 5-step model (`discover, harvester, process, learn, complete`);
  pct derived from the last event's stage index (min 5%, 100% when done, 0% on error). Labels:
  Harvesting / Profiling / Learning / Done.
- **Profiling sub-progress bar** — appears during the `process` stage; shows processed/total, a
  violet fill, and rate/ETA. `effectiveTotal` is derived from `hitsDiscovered` OR parsed out of
  activity-log messages like "Processing batch: X hits (Y done…)" / "N raw hits collected".
- **Harvester grid** — 3-column grid of 10 fixed cards (`HARVESTERS`: gdelt, hackernews, reddit,
  rss, wordpress, ghost, websearch, scrapegraph, commoncrawl, wayback). Per-card state
  (`idle/running/done/skipped/error`) and hit counts are **parsed from the event `message`
  strings** (e.g. "disabled"→skipped, "→ 12 articles"→hits, "total: 47"→hits). When the run ends,
  any still-"running" cards flip to "done". Note the grid list and the harvesters the pipeline
  actually runs differ slightly (e.g. googlenews/duckduckgo/brave are not distinct grid cards).
- **Activity log** — auto-scrolling monospace feed of every event, colorized by harvester or
  stage. Empty text differs by whether it's running ("Waiting for events…") or idle. A blinking
  cursor shows while running.
- **Stats summary** — up to four tiles (Hits / Processed / Authors / Errors) from the `stats`
  prop, plus a "learned subreddits · domains" tile when present.

---

### Client-side run orchestration (`page.tsx` state machine)

Discovery is driven **entirely by polling**, not by an open SSE connection (reprocess is the
exception — it streams). Key refs/state: `isDiscovering`, `isStopping`, `isReconnected`
(mirrored into `isReconnectedRef`), `sawRunningRef` (have we ever observed it running?),
`discoverStartRef` (kickoff time, for the startup grace window), `pipelineEvents`,
`pipelineStats`, `pipelineDone/Error`, `pipelineElapsedMs`, `liveRun`, `runHistory`,
`savedHitCounts`, `resumableCheckpoint`.

- **`runDiscovery(resume=false)`** (lines 223-264) — resets pipeline UI state, switches to the
  pipeline tab, marks itself as a polled run (`setReconnected(true)`, `sawRunningRef=false`,
  `discoverStartRef=now`), then `POST /api/discover` with `{resume:true}` OR `{campaign_id}`. If
  the response is not ok or `started === false`, it surfaces `data.reason ?? data.error` and
  bails. On success it toasts "Discovery started — it keeps running even if you close this tab"
  and calls `pollLive()` once (the polling effect keeps it going).
- **`pollLive()`** (lines 139-185) — `GET /api/pipeline/live` every 4s while the pipeline tab is
  open and not actively streaming. If `isRunning`: replays `bufferedEvents` into
  `pipelineEvents`, updates elapsed, and sets cumulative `pipelineStats` from `runProgress`
  (delta vs. baseline) with fallbacks to the latest event. When it flips to not-running: clears
  the interval, and — only if we had marked ourselves reconnected — declares **done** (if we ever
  saw it running: toast success, reload history + prospects) or **error** ("Discovery didn't
  start…") if it never started within a 30s grace window (`discoverStartRef`).
- **Polling effect** (lines 188-195) — starts/stops the 4s interval based on `activeTab`,
  `isDiscovering`, `isReconnected`.
- **`stopDiscovery()`** (lines 266-269) — sets `isStopping`, `POST /api/pipeline/stop`.
- **`runReprocess(source?)`** (lines 271-332) — the ONLY streaming path. `POST /api/reprocess`
  and reads the SSE `data:` lines directly: `stage:"done"` sets done + stats + reloads;
  `stage:"error"` toasts; anything else is appended to `pipelineEvents`. Drives its own elapsed
  timer via `elapsedRef`.
- **`wipeAndReset()`** (lines 334-355) — confirm, then `POST /api/admin/wipe`; clears local state
  on success.
- **On mount** (lines 197-200): loads `/api/campaigns` and `/api/pipeline/checkpoint`
  (→ `resumableCheckpoint`). `loadRunHistory` (lines 127-136) loads `/api/pipeline` (run history)
  and `/api/reprocess` (unprofiled counts) together.

---

### API routes / server logic

**Auth note (applies to all routes below):** there is no per-route session check inside most of
these handlers. Access control is enforced by `src/proxy.ts`, which redirects any unauthenticated
request to `/login` **except** `/api/auth/*`, `/api/health`, and requests carrying the
`CRON_SECRET` (as `Authorization: Bearer <secret>` or `?key=<secret>`). So the discovery routes
require a logged-in session OR a valid cron secret; the QStash auto-continuation supplies that
secret. The one exception that re-checks in-handler is `/api/admin/wipe` (calls `auth()`).

#### `POST /api/discover` — start (or resume) a discovery run

File: `src/app/api/discover/route.ts`. `maxDuration = 300`.

Request body (all optional): `{ campaign_id?, resume?: true, auto?: true }`.

Logic:

1. **Resume mode** (`body.resume === true`): loads the latest checkpoint. If found, restores
   `usedQueries/round/rssComplete/discoveryDone/oldRunId` and inherits `campaignId`/
   `customKeywords` from it. **If the checkpoint is missing** (evicted / a chunk died before
   re-saving), it does NOT restart a fresh run; instead it checks for unprocessed
   `discovery_hits` — if any exist it resumes in processing-only mode (`round:99, rssComplete,
   discoveryDone:true`); if none, it returns `{ started:false, reason:"no checkpoint and no
   pending work to resume" }`. This is the guard against the "restarts everything mid-run" bug.
2. **Global lock** — a fresh (non-resume) start must `acquireDiscoveryLock` (Redis `SET NX`,
   TTL 330s). If not acquired: returns `{ started:false, alreadyRunning:true, reason:"A discovery
   is already running. Only one can run at a time." }`. On a fresh start it also snapshots
   baseline counts (hits/processed/authors) and start time into Redis (`startDiscoveryMeta`) so
   the UI shows one continuous timer + cumulative progress. Resume continuations do NOT take the
   lock (the run already holds it) — they call `refreshDiscoveryLock` to extend it across the
   hand-off gap.
3. **Campaign wiring** — on a fresh campaign run, loads the campaign, derives `customKeywords`
   (its keywords), `seedWriter` (name/article URL), `seedDomains`, `seedArticleUrls`, and sets
   campaign `status:"running"`. On resume with a campaign, just re-marks it running.
4. **Kickoff** — schedules `runDiscoveryPipeline(...)` inside `after(...)` so it runs independent
   of the request/tab. Wrapped in try/catch: on throw it best-effort sets the campaign
   `status:"done"`.
5. **Response** — `{ started:true, auto: body.auto === true }` (returned immediately; the run
   continues in the background).

`GET /api/discover` returns `{ message: "POST to this endpoint to start discovery" }`.

#### `GET /api/pipeline` — run history

File: `src/app/api/pipeline/route.ts`. Returns `getPipelineRuns(20)` — the 20 most recent
`pipeline_runs` rows (each: id, started_at, finished_at, stage, status, stats, error). No params.

#### `GET /api/pipeline/live` — live status snapshot (the poll target)

File: `src/app/api/pipeline/live/route.ts`. No params. Core logic:

- `isRunAlive()` — true if a recent Redis heartbeat exists (or an in-memory run on this instance),
  so a run on another serverless instance is not mistaken for dead (staleness window 90s).
- Reads the most recent `pipeline_runs` row with `status:"running"`. **Auto-close guard:** if
  that row is not alive AND older than 90s, it marks it `failed` ("Auto-closed: no heartbeat…")
  and drops it — this reaps runs whose function was killed. Rows younger than 90s are left alone
  (could be mid-startup).
- Live counts straight from the DB: total hits, processed hits, total authors.
- `getBufferDurable()` — the durable event buffer (Redis snapshot or in-memory).
- `getDiscoveryMeta()` — the baseline+start captured at fresh start; used to compute
  `runProgress` (`discovered/processed/authors` as deltas vs. baseline, floored at 0) and a
  single cumulative `elapsedMs`.
- Resolves the `campaign` this discovery is scoped to (from meta, else from the resume
  checkpoint, else `{id:null,name:null}` = "All prospects").
- **Response:** `{ isRunning: alive || !!activeRun, activeRun, totalHits, processedHits,
  totalAuthors, bufferedEvents, bufferRunId, elapsedMs, runProgress, campaign }`.

#### `GET /api/pipeline/checkpoint` — resumable checkpoint

File: `src/app/api/pipeline/checkpoint/route.ts`. Returns `findLatestCheckpoint()` (or `null`).
The UI uses this on mount to decide whether to show the amber "Resume (round N)" button.

#### `POST /api/pipeline/stop` — stop a run

File: `src/app/api/pipeline/stop/route.ts`. Calls `requestStop()` (aborts the local
`AbortController` AND sets the durable Redis `pipeline:abort` flag with 1h TTL so a run on
another instance halts). Always returns `{ stopped:true }`.

#### `POST /api/reprocess` — re-extract unprofiled saved hits (SSE)

File: `src/app/api/reprocess/route.ts`. `maxDuration = 300`. Body: `{ source?, campaign_id? }`.
Returns a `text/event-stream` `ReadableStream`: it runs `runReprocessPipeline` and streams every
progress event as `data: {...}\n\n`, then a final `{ stage:"done", runId, stats }`, or
`{ stage:"error", message }` on throw. `GET /api/reprocess` returns `countUnprofiledHits()`
(`{ total, handled, unprofiled }`) — used to populate the "Profile New Articles" card and
`savedHitCounts`.

#### `GET /api/score-stats?campaign_id=` — score distribution

File: `src/app/api/score-stats/route.ts`. Returns `getScoreStats(campaignId?)` =
`{ count, min, max, avg, median }` of best-per-author composite scores (optionally scoped to a
campaign's authors). Used elsewhere to guide the min-score threshold.

#### `GET/POST /api/seeds` — seed tools CRUD

File: `src/app/api/seeds/route.ts`. `GET` → all seeds. `POST`/`PATCH` upsert
`{ name, aliases?, enabled?, category? }` (400 if no `name`; category defaults "competitor").
`DELETE` removes by `{ id }` (400 if none). Seeds drive query generation and mention detection.

#### `GET/PATCH /api/harvesters` — harvester config

File: `src/app/api/harvesters/route.ts`. `GET` → all `harvester_config` rows. `PATCH`
`{ id, enabled?, config? }` (400 if no `id`) toggles a harvester or updates its config (e.g.
reddit's `subreddits` array).

#### `GET/POST /api/learned-sources` — self-learned sources

File: `src/app/api/learned-sources/route.ts`. `GET` → learned sources sorted by score.
`POST { id, action }` where action is `promote` or `reject` (400 otherwise). Promotion of a
subreddit writes it into the reddit harvester's config; domain promotion is read directly by the
pipeline. Reviewed under Admin → Learning.

#### `POST /api/prospects/manual` — manually add a prospect

File: `src/app/api/prospects/manual/route.ts`. Body: `{ full_name, email?, publication?,
article_urls: string[] (or legacy article_url), campaign_id? }`. Requires a name and ≥1
`https?://` article link (400 otherwise). Derives the publication host (explicit field → email
domain → first article's host; 400 if none). Creates domain + author (`source:"manual"`,
`role:"writer"`), an article per URL (title derived from the slug) linked to the author, an
optional `mailto` contact (confidence 1), a seed score of composite/relevance/authority/
freshness = 50 (so it surfaces in sorted lists), and links to a campaign if given. Returns
`{ ok:true, author_id, articles }` or `{ error }` (500).

#### `POST /api/admin/wipe` — destructive reset

File: `src/app/api/admin/wipe/route.ts`. **Re-checks `auth()`** (401 if no session). Deletes, in
FK order: scores, mentions, links, contacts, article_authors, articles, authors, domains,
discovery_hits. Keeps seeds + harvester config. Returns `{ ok:true, results }`.

#### `GET /api/prospects` — the dashboard's main data source

File: `src/app/api/prospects/route.ts`. Query params: `limit, offset, minScore, archetype, tool,
hasContact, email_status, search, sortBy, include (stats,charts), campaign_id, exclude_discarded,
qualified_only, min_dr`. Runs `getProspects(...)` plus (when `include` says so) the five
dashboard aggregates in parallel. Returns `{ prospects, total, stats, toolCounts, timeline,
provenance, publications }` or `{ error }` (500).

---

### Core pipeline logic — `runDiscoveryPipeline` (`src/lib/pipeline/run.ts`)

Signature: `runDiscoveryPipeline(onProgress?, options?: DiscoveryOptions)`. `DiscoveryOptions` =
`{ campaignId?, customKeywords?, seedWriter?, seedDomains?, seedArticleUrls?, resume? }`.

Setup:

- Creates a fresh `AbortController` (`createPipelineController` — aborts any previous local run),
  clears the stale durable stop flag, creates a `pipeline_runs` row (`createPipelineRun("full")`),
  and starts the in-memory event buffer + overwrites the stale Redis snapshot.
- **Time budget:** on Vercel (`isServerless()` = `VERCEL === "1"`) the deadline is now + 210s
  (below the 300s hard limit); locally it is `Infinity`.
- **Heartbeat interval (2.5s):** snapshots the buffer to Redis, refreshes the global discovery
  lock (keeps it alive while working), and polls `isStopRequested()` — if the durable stop flag
  is set it aborts the local controller. This is how a Stop on another instance reaches the run.
- `handedOff` flag — set only when this chunk schedules a QStash continuation; the `finally` block
  keeps the global lock only in that case, releasing it on every other exit.
- `emit(stage, message, extra)` — builds an event (spreads `stats`), pushes to the buffer, and
  calls `onProgress`.

**Stage 1 — Discover / harvest:**

- Loads seeds + harvesters (`getSeeds`, `getHarvesters`). `enabledSeeds` filtered by `enabled`;
  `ourProductSeeds` = category `our_product` (their names/aliases feed the competitor-overlap
  score). Builds `harvesterMap` from enabled harvesters; logs each harvester's enabled/disabled
  state (and key-gated ones: websearch, scrapegraph, brave).
- **Resume handling:** does NOT delete the checkpoint at the start of a resumed chunk (must
  survive until it re-saves — deleting it early was the source of the mid-run restart bug).
- **RSS crawl (once, upfront)** — skipped if `resume.rssComplete`. Source set =
  `SEED_DOMAINS` ∪ auto-learned promoted domains ∪ cleaned campaign `seedDomains`. Uses a
  **rotating 70-domain window** keyed by day-of-year so a big list is covered across successive
  daily runs within the time budget; campaign sites are always included in full. Runs
  `rssHarvester`, dedupes by URL, drops already-profiled URLs, bulk-inserts in chunks of 500.
  After completion (if not aborted) saves a checkpoint with `rssComplete:true, discoveryDone:false`.
- **Author-seed harvest (fresh runs only):**
  - `seedArticleUrls` (campaign "articles") — inserted directly as `discovery_hits`
    (`source:"seed_article"`) so Stage 2 profiles each and extracts its author.
  - `seedWriter` — `resolveAuthorSeed` finds the writer's page/domain (from an article URL, or by
    searching their name), then `harvestAuthorArchive` pulls their other same-domain article URLs;
    all queued as `source:"author_seed"`. See `src/lib/pipeline/authorSeed.ts`.
- **Query round loop** — up to `MAX_QUERY_ROUNDS = 15`, target `TARGET_NEW_HITS = 2500` pending
  hits. Skipped entirely if `resume.discoveryDone`, or if it's a writer-only campaign (seedWriter
  with no keywords — `skipKeywordLoop`). Each round:
  - Counts pending hits; breaks if target reached.
  - `generateDiscoveryQueries(enabledSeeds, usedQueries, customKeywords)` (see below) → 30
    queries; filters out already-used ones; breaks if none fresh.
  - Fans out queries to enabled harvesters via a `PQueue` (concurrency 12), each with per-round
    slice caps: **GDELT** first 20, **Hacker News** 8, **Reddit** 6 (with configured subreddits,
    depth 3), **WordPress** 5 (first 30 seed domains), **Brave** 5 (only if key), **Google News**
    20 (free), **DuckDuckGo** 20 (free), **web-search API** 5 (only if `searchEnabled()`),
    **ScrapeGraph** 3 (only if `SGAI_API_KEY`). All results `insertDiscoveryHits`-ed.
    ghost/commoncrawl/wayback log "Implementation pending — skipping".
  - Saves a checkpoint every round. Weak-round early-stop: two consecutive rounds under
    `MIN_NEW_PER_ROUND = 15` new hits ends discovery early. Aborts cleanly if stopped.

**Stage 2 — Process hits (extract + score):**

- Loads up to `MAX_TOTAL = 5000` pending hits (`getAllPendingHits`), then filters: drops
  `isBlockedUrl` (video/social/aggregator), dedupes by URL, and skips already-profiled URLs
  (`getProfiledUrlSet`).
- Processes with a `PQueue` (concurrency `CONCURRENCY = 8`) in `BATCH_SIZE = 100` chunks
  (drains each batch before queuing the next, to bound memory — each worker holds full HTML).
- Each hit → `processHit(...)`. Success increments `stats.processed`; a returned author id is
  added to `discoveredAuthorIds` (distinct). Every hit is marked processed in `finally`.
  Progress emitted every 25 hits.
- **Serverless hand-off:** if the 210s budget is hit with hits still pending, it saves a
  checkpoint with `discoveryDone:true` (so the resume skips straight to processing, never
  re-entering the round loop), and calls `qstashPublish("/api/discover", {resume:true, auto:true})`
  to continue in a fresh invocation. If QStash succeeds it keeps the lock (`handedOff=true`); if
  not, it tells the user to click Resume. Ends this chunk's `pipeline_runs` row as `completed`
  with `continued` flag.
- Sets `stats.authors = discoveredAuthorIds.size` (distinct, not per-hit).

**Campaign linking** — if `campaignId`: resolves ALL author ids tied to the processed URLs
(`getAuthorIdsForUrls`) unioned with freshly-created ones (because re-discovered existing
articles return no new author id), links them via `linkAuthorsToCampaign`, and sets campaign
`status:"done"`.

**Stage 2.5 — Email enrichment** — DISABLED by default. Only runs if
`ENRICH_ON_DISCOVERY === "true"` and an enricher is configured. (Enrichment normally runs on
demand from the Email Finder page.)

**Stage 3 — Self-learning** — `runLearningPhase()` (`src/lib/learn/index.ts`): mines reddit hits
for productive subreddits, and authors' publisher domains for productive sites (auto-promotes a
domain with ≥2 authors or ≥1 emailable author; auto-promotes all new subreddits into the reddit
harvester config). Records `learnedSubreddits/learnedDomains/promoted` into stats.

**Auto email-finder** — unless aborted, `qstashPublish("/api/enrich/run", {campaign_id, only_new:
true, auto:true})` kicks off automatic email finding for the new authors in a fresh invocation.

**Completion / cleanup** — emits "All done!", deletes the checkpoint, finishes the buffer, marks
the run `completed` with final stats. On throw: marks `failed`, rethrows. `finally`: clears the
heartbeat, releases the global lock (unless handed off), snapshots the buffer once more, and
always closes the shared Playwright browser.

#### `processHit(hitId, url, source, seeds, ourProductNames, abortSignal)` (extract pipeline)

Per-article extraction, reused by discovery, reprocess, and author-watch rechecks:

1. Parse host; skip `isBlockedUrl`; skip if `isSuppressed(host)`.
2. Skip URLs already an `articles` row — but return the existing article's author id so campaign
   linking still captures re-discovered articles.
3. `fetchPage(url)` — real-Chrome-UA fetch (8s timeout); escalates to Playwright only if the HTML
   looks JS-rendered (<500 chars of text) AND `PLAYWRIGHT_ENABLED === "true"`. Returns null on
   failure (→ hit dropped).
4. `extractMetadata` (JSON-LD → OpenGraph → Twitter → standard meta, with several byline
   fallbacks). English-language gate (`isLikelyEnglish` on URL path + title) — non-English pages
   are dropped.
5. `extractReadability` for body text.
6. `upsertDomain(host, …)`; best-effort real **Domain Rating** fetch (free Ahrefs endpoint, 0
   units) once per domain so the DR≥50 qualification filter has data — never blocks discovery.
7. `scoreArticleRelevance(title, snippet)` (LLM, fails open) — **if not relevant, the article is
   dropped** (no author created).
8. `classifyArchetype` → listicle/comparison/review/explainer/news.
9. `upsertArticle(...)`; `detectMentions` → `upsertMention` per tracked tool; `extractOutboundLinks`
   → `links` (capped 50).
10. **Author gate:** only create an author if the byline passes `isLikelyPersonName` (filters out
    "Staff", section names, publication names, bios).
11. `upsertAuthor`, `linkArticleAuthor`. Contacts: `extractContacts` **minus `mailto`** (discovery
    never saves scraped emails — the Email Finder resolves the real one), capped 10; plus an
    `author_page` contact if a metadata author URL exists.
12. `computeScore(...)` from the author's contacts, this article's mentions, domain article count,
    and the LLM relevance score → `upsertScore`.
13. **Content safety** (`classifyContentSafety`, LLM, fails open) — if flagged, insert
    `flagged_content` and recompute the author's safety score; always mark the article
    safety-checked. Never blocks the pipeline.
14. Returns the author id (or undefined if no valid author).

#### `runReprocessPipeline(opts, onProgress)` (same file)

Skips discovery entirely. Loads only **unprofiled** hits (`getUnprofiledHits` — pending AND not
already an article), optionally filtered by `source`; drops blocked URLs; processes them exactly
like Stage 2 (`processHit`, concurrency 8, 100-batches). Links reprocessed authors to a campaign
if given, runs the learning phase, and finishes. This is what the "Profile New Articles" card and
`/api/reprocess` invoke. It uses its own local controller and always closes the shared browser.
It does NOT take the global discovery lock (so a reprocess can run alongside — see cautions).

---

### Supporting modules

- **Query generation** (`src/lib/pipeline/queries.ts`) — `generateDiscoveryQueries` asks
  `anthropic/claude-haiku-4-5` via **OpenRouter** (`OPENROUTER_API_KEY`, temp 0.9, 15s timeout)
  for 30 fresh, diverse editorial queries, seeded with the tracked competitors, and either the
  campaign's `customKeywords` or the seed topics. Shows the model the last 30 used queries to
  avoid repeats. Falls back to a static ~26+ template list (expanded per tool) if there's no key,
  the call fails, or fewer than 10 fresh queries come back.
- **Checkpoint** (`src/lib/pipeline/checkpoint.ts`) — a SINGLE record (`pipeline:checkpoint` in
  Redis, 24h TTL; local filesystem `.pipeline-checkpoints/<runId>.json` fallback in dev). Fields:
  `runId, round, usedQueries, rssComplete, discoveryDone?, campaignId?, customKeywords?, savedAt`.
- **Event buffer** (`src/lib/pipeline/eventBuffer.ts`) — in-memory ring buffer (max 600 events)
  PLUS a durable Redis mirror (`pipeline:buffer`, last 200 events + heartbeat, 1h TTL). `isRunAlive`
  = a heartbeat newer than 90s (or an in-memory run). This is what survives a page refresh /
  instance change so the reconnect poll can replay progress.
- **Abort** (`src/lib/pipeline/abort.ts`) — an in-process `AbortController` for same-instance
  aborts + a durable Redis flag (`pipeline:abort`, 1h TTL) polled by the heartbeat for
  cross-instance stops. `clearStop` runs at the start of every fresh pipeline.
- **Redis** (`src/lib/redis.ts`) — Upstash REST client, gated by `UPSTASH_REDIS_REST_URL/TOKEN`.
  When unset (local dev) `redis()` returns null and every helper degrades gracefully (single
  instance, locks always "acquired", no durable buffer/meta/checkpoint). Holds the global
  `discovery:lock` (TTL 330s) and `discovery:meta` (baseline+timing, 24h).
- **QStash** (`src/lib/qstash.ts`) — `qstashPublish` POSTs one of our own endpoints (with the
  `CRON_SECRET` bearer) to auto-continue long jobs; no-op if `QSTASH_TOKEN` + base URL are unset.
  `isServerless()` = `VERCEL === "1"`.
- **Web search** (`src/lib/search/webSearch.ts`) — provider-agnostic real search API, picking the
  first configured key: TAVILY → GOOGLE_CSE → BRAVE → SERPER. Tavily uses a rotating key pool that
  marks a key exhausted on 402/403/429/432 and rolls to the next.
- **Scoring** (`src/lib/score/index.ts`) — `computeScore` weights: relevance 35% (blends LLM
  0.7 + keyword 0.3 when LLM present), competitor overlap 20%, freshness 15% (decays over ~180
  days), authority 20% (domain article count + author article count), contact confidence 10%.
- **Qualification** (`src/lib/score/qualify.ts`) — `qualifyProspect`: DR≥50 and relevance≥40 (or
  ≥5 mentions) are the "free" filters that qualify; traffic≥10K/mo and US-share>50% are "paid"
  filters that only disqualify when VERIFIED false, never when null/unverified. `fit` (0-100) is a
  renormalized weighted blend of whatever real signals exist. Used at read time by the
  `qualified_only` toggle — it is NOT part of `computeScore`.

---

### Harvesters (`src/lib/harvesters/*`)

Each exports `{ name, run(query, opts) => RawHit[] }` (`RawHit` = `{ url, title?, snippet?,
source, query?, discoveredAt }`). `index.ts` re-exports them and defines `HarvesterName`.

- **gdelt.ts** — GDELT DOC 2.0 API, free, last 180 days, up to 250 records, sorted by hybrid
  relevance.
- **hackernews.ts** — HN Algolia search, `points>5`; emits both the external article URL and the
  HN discussion URL.
- **reddit.ts** — Reddit JSON with a 700ms inter-request delay; searches configured subreddits to
  a depth; snippets encode `r/<sub> • <pts>` (feeds subreddit learning). Only non-reddit external
  URLs become hits.
- **rss.ts** — discovers feeds/sitemaps per domain (common paths, robots.txt sitemaps, homepage
  `<link>`s) and extracts article URLs. The freshness/self-expanding backbone.
- **wordpress.ts** — probes `/wp-json/wp/v2/` and queries the posts endpoint by search term.
- **googlenews.ts** — Google News RSS search, free, no key.
- **duckduckgo.ts** — DuckDuckGo HTML endpoint, free, paginated (used inside discovery even though
  it's not a distinct grid card).
- **websearch.ts** — wraps `webSearch()` (real API, gated by a search key).
- **scrapegraph.ts** — ScrapeGraphAI LLM search, gated by `SGAI_API_KEY` (costs credits, kept
  conservative).
- **brave.ts** — Brave Search API, gated by `BRAVE_SEARCH_API_KEY`, freshness "past month".
- **ghost.ts / commoncrawl.ts / wayback.ts** — implemented harvester modules but **NOT wired into
  the discovery run** (the pipeline logs them as "Implementation pending — skipping"). They exist
  and could be invoked elsewhere, but a normal run never calls them.

---

### Key checks & validations

- **Single-run global lock** — a fresh discovery must acquire `discovery:lock` (Redis `SET NX`,
  330s TTL) or it's refused with `alreadyRunning`. Refreshed by the heartbeat and by resume
  chunks; released only on completion/stop/error (not on hand-off).
- **Blocked-URL filter** (`isBlockedUrl`) — applied at insert, at Stage-2 load, and inside
  `processHit`: video/social/audio platforms + Google redirect/search hosts are never profiled.
- **Dedup + already-profiled skip** — hits upsert on `(url, source)` with `ignoreDuplicates`;
  Stage 2 and RSS both skip URLs already in `articles` (`getProfiledUrlSet`) so re-runs never
  re-fetch or re-score finished work.
- **Relevance gate** — LLM relevance must return relevant, or the article is dropped (no author).
- **Person-name gate** (`isLikelyPersonName`) — bylines that aren't real people are discarded.
- **English gate** (`isLikelyEnglish`) — non-English URL locales/titles are dropped.
- **No scraped emails at discovery** — only non-mailto contacts are saved; emails come later.
- **Manual add** — requires a name and ≥1 valid URL; derives a domain or 400s.
- **Wipe** — requires a session (`auth()`), and a client-side `confirm()`.
- **Fail-open LLM calls** — relevance and safety both fail open on API error/timeout so
  classification never blocks the pipeline (relevance falls back to a keyword heuristic).

---

### Flows

**A. User runs a fresh discovery**

1. User optionally picks a discovery campaign, clicks **Run Discovery**.
2. `runDiscovery(false)` resets UI, switches to the Pipeline tab, `POST /api/discover {campaign_id}`.
3. Route acquires the global lock (or returns `alreadyRunning` → error toast), snapshots baseline
   meta, marks the campaign running, and schedules `runDiscoveryPipeline` in `after()`.
4. Route returns `{started:true}` immediately; UI toasts "started" and begins polling
   `/api/pipeline/live` every 4s.
5. Pipeline: seeds/harvesters → RSS crawl → (author-seed) → query rounds → process hits → campaign
   link → learn → auto email-finder → complete.
6. Each poll replays buffered events into `PipelineProgress` and updates cumulative stats/elapsed.
7. When `live` reports not-running (and we had seen it running), UI marks done, reloads run
   history + prospects, toasts success.

**B. Serverless time budget exceeded (Vercel)**

1. After ~210s a chunk saves a checkpoint (`discoveryDone:true` if only profiling remains) and
   `qstashPublish("/api/discover",{resume:true,auto:true})`.
2. It keeps the global lock (`handedOff`) and ends its `pipeline_runs` row as completed/continued.
3. QStash POSTs `/api/discover` (with the cron secret) → resume path loads the checkpoint,
   refreshes the lock, continues. The UI keeps polling and sees continuous cumulative progress.

**C. Resume after interruption**

1. On mount the UI fetches `/api/pipeline/checkpoint`; if present it shows "Resume (round N)".
2. `runDiscovery(true)` → `POST /api/discover {resume:true}` → loads checkpoint (or falls back to
   processing-only if the checkpoint is gone but hits are pending, else refuses) and continues.

**D. Stop**

1. User clicks **Stop** → `stopDiscovery` sets `isStopping`, `POST /api/pipeline/stop`.
2. `requestStop` aborts the local controller and sets the durable Redis flag.
3. The running pipeline's heartbeat sees the flag (within 2.5s) and aborts; queues clear, the run
   emits "stopped" and finishes as completed with `stopped:1`.

**E. Reprocess unprofiled hits (campaign selected)**

1. "Profile New Articles" card shows `savedHitCounts.unprofiled`. User clicks **Profile**.
2. `runReprocess()` opens the SSE `POST /api/reprocess {campaign_id}`.
3. The client reads streamed events into `PipelineProgress`; on `done` it reloads prospects +
   history and toasts.

**F. Data flow: hit → prospect**

`harvester.run()` → `insertDiscoveryHits` (dedup) → `getAllPendingHits` → `processHit`
(fetch → metadata → readability → domain+DR → relevance gate → archetype → article → mentions →
links → person-name gate → author → contacts → score → safety) → `authors`/`scores` rows →
`GET /api/prospects` → dashboard card.

---

### Edge cases & cautions

- **`PLAYWRIGHT_ENABLED` gating** — Playwright is used only when `PLAYWRIGHT_ENABLED === "true"`
  AND the plain fetch returned JS-rendered stub HTML. If unset (the Vercel default), JS-heavy SPA
  pages yield little/no text and often no author — they're silently dropped. The shared-browser
  singleton is always closed in the pipeline's `finally` (a memory-leak fix); a leaked browser
  process is ~200MB.
- **Global keying is coarse** — the single `discovery:lock`, the single `discovery:meta`, the
  single `pipeline:checkpoint` key, and the single event buffer mean the entire installation runs
  ONE discovery at a time for ALL users. A second user's "Run Discovery" is refused with
  `alreadyRunning`. Campaign scoping happens inside that one run, not via parallel runs.
- **Reprocess is NOT lock-guarded** — `runReprocessPipeline` doesn't take the discovery lock and
  `/api/reprocess` doesn't check it, so a reprocess can run concurrently with a discovery. Both
  call `processHit` and share the same abort controller (`createPipelineController` aborts any
  prior local run), so starting one can abort the other's local controller on the same instance.
- **No-Redis (local dev)** — with Upstash unset there is no cross-instance durability: the lock is
  always "acquired", `getDiscoveryMeta`/checkpoint fall back to in-memory/filesystem, `isRunAlive`
  relies on the in-memory buffer only, and a durable Stop won't reach another process. Fine for a
  single local instance; unsafe assumptions if deployed without Redis.
- **Stale-run auto-close is heuristic** — `/api/pipeline/live` marks a `running` row `failed` only
  if there's no heartbeat AND it's older than 90s. A genuinely long, healthy chunk that stops
  heartbeating (e.g. event loop blocked) for >90s could be wrongly auto-closed; conversely a dead
  run younger than 90s still shows as running.
- **Progress numbers are partly string-parsed** — `PipelineProgress` derives per-harvester hit
  counts and the processing total by regex-matching event `message` text ("total: 47",
  "→ 12 articles", "Processing batch: X hits (Y done)"). Message wording changes will silently
  break these displays without breaking the run.
- **Harvester grid vs. reality mismatch** — the grid shows ghost/commoncrawl/wayback (which the
  run skips as "Implementation pending") and omits googlenews/duckduckgo/brave (which the run
  actually uses). Provenance in the Overview chart reflects real sources; the grid can mislead.
- **"Reconnected/error" grace window** — after kicking off a run, if `/api/pipeline/live` never
  reports running within 30s (`discoverStartRef`), the UI declares an error ("Discovery didn't
  start"). A slow `after()` registration or a lost Redis heartbeat can produce a false error even
  though the run is actually proceeding.
- **Checkpoint is a single key with a 24h TTL** — if it's evicted mid-run and there are no pending
  hits, a resume simply refuses. The deliberate design avoids the worse failure (restarting the
  whole crawl); it does mean a resume can no-op instead of finishing edge-case work.
- **Reprocess/discovery `stats.authors`** — counted as distinct author ids for display and
  campaign linking, but `stats.processed`/errors are per-hit; a run that re-discovers many
  existing articles shows high "processed" with few new authors.
- **Relevance/safety cost + fail-open** — every profiled article makes up to two OpenRouter
  (Claude Haiku) calls; without `OPENROUTER_API_KEY` relevance degrades to a keyword heuristic and
  safety screening is skipped entirely (everything treated clean). Off-topic keywords short-circuit
  before any API call.
- **Wipe keeps seeds/harvesters but is otherwise total and irreversible** — it deletes all
  scores/mentions/links/contacts/authors/articles/domains/hits with only a browser `confirm()` and
  a session check; there is no per-campaign scoping and no undo.
- **Manual prospects seed a flat score of 50** — so they appear in sorted lists but their score is
  synthetic, not derived from real relevance/authority signals until (if ever) they're reprocessed.
- **`after()` independence** — a discovery keeps running even if the user closes the tab or
  navigates away; the only ways to stop it are the Stop button (durable) or the lock/TTL expiring.
  Multiple rapid "Run Discovery" clicks are safe (subsequent ones are refused), but the first click
  commits a full crawl.

---

## Campaigns

### Purpose

A **Campaign** is a named, reusable "discovery scope" — a bundle of keywords and/or seeds (a specific writer, a list of sites, and/or a list of article URLs) that focuses which writers get pulled into the system when you run the discovery pipeline. Once a campaign exists, every author that discovery profiles during a campaign-scoped run is linked to that campaign (via the `campaign_authors` join table), so downstream the app can filter Prospects, Workflows, score statistics, and the Email Finder to just that campaign's authors.

In plain terms: a campaign answers "for this outreach push, which topics/sites/writers do I care about, and which authors did we find for it?" It is the top-level container that scopes the rest of the funnel. Campaigns are **global** (not owned per-user) — see Edge cases.

Source anchors:
- UI page: `src/app/campaigns/page.tsx`
- List/create API: `src/app/api/campaigns/route.ts`
- Read/update API: `src/app/api/campaigns/[id]/route.ts`
- Per-campaign discovery API (orphaned — see cautions): `src/app/api/campaigns/[id]/discover/route.ts`
- Global seed-tools API: `src/app/api/seeds/route.ts`
- DB query layer: `src/lib/db/queries.ts` (Campaigns section starts ~line 908)
- Type: `Campaign` in `src/lib/types.ts` (line 198)
- Where campaigns actually drive discovery: `src/app/api/discover/route.ts` + `src/lib/pipeline/run.ts`

---

### The `Campaign` shape

Defined at `src/lib/types.ts:198`:

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID primary key |
| `name` | string | Required; free text |
| `keywords` | string[] | Lowercased tag list; biases discovery query generation |
| `region` | string? | Accepted by the API/DB but **never set by the UI** and only read as a passthrough (largely vestigial) |
| `target_hits` | number | Defaults to `2500` on create; displayed on the card but **not enforced** as a real per-campaign cap (the pipeline's own `TARGET_NEW_HITS = 2500` is a global run target, not campaign-scoped) |
| `status` | `"draft" \| "running" \| "done"` | Lifecycle badge |
| `created_at` | string | ISO timestamp |
| `author_count` | number? | Computed at read time from `campaign_authors`, not stored |
| `seed_writer_name` | string \| null | Optional single-writer seed |
| `seed_article_url` | string \| null | Optional one article link for that writer |
| `seed_domains` | string[] \| null | "Sites to outreach" — mined via RSS/sitemap |
| `seed_article_urls` | string[] \| null | "Specific articles to outreach" — authors pulled from each URL |

---

### UI walkthrough — `src/app/campaigns/page.tsx`

The page is a client component (`"use client"`). On mount it calls `fetchCampaigns()` → `GET /api/campaigns` and renders a responsive grid of campaign cards.

#### Header (lines 86–102)
- **Megaphone icon + "Campaigns" title** and a subtitle: *"Create campaigns with keywords, then select them in the Discovery dropdown on the Prospects page."* This is the intended workflow — campaigns are created here, but discovery is launched from the Prospects/dashboard page.
- **"New Campaign" button** (top-right, `Plus` icon) → `openNew()`: resets `editingId` to `null`, clears the form, and opens the dialog in create mode.

#### Loading / empty / grid states (lines 105–171)
- **Loading state**: while `loading` is true, shows a spinner with "Loading campaigns...".
- **Empty state** (`campaigns.length === 0`): a dashed-border panel with a faded Megaphone, the message *"No campaigns yet — create one, then select it when running discovery"*, and a **"Create Campaign"** outline button (also calls `openNew()`).
- **Populated grid**: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`. Each campaign renders one card.

#### Campaign card (lines 119–168)
Per card:
- **Name** (truncated) and **created date** (`new Date(c.created_at).toLocaleDateString()`).
- **Status badge** via `StatusBadge` (lines 13–17):
  - `done` → green "Done" badge.
  - `running` → amber "Running" badge with a spinning `Loader2`.
  - anything else (`draft`) → outline "Draft" badge.
- **Edit button** (`Pencil` icon, ghost) → `openEdit(c)`: sets `editingId` to the campaign id and pre-fills the form from the campaign (keywords, seed writer name, seed article URL, and `seed_domains`/`seed_article_urls` joined back into newline-separated textarea text), then opens the dialog in edit mode.
- **Keyword / seed pills** (lines 137–161): renders, in order:
  - Each keyword as a violet pill.
  - If `seed_writer_name` set → a blue pill `✍ {name}`.
  - If `seed_domains` non-empty → an emerald pill `🌐 {n} site(s)` (singular/plural handled).
  - If `seed_article_urls` non-empty → an amber pill `📄 {n} article(s)`.
  - If **none** of keywords/seed writer/seed article/seed domains/seed article URLs are set → italic muted text *"No keywords — uses global seeds"* (meaning discovery falls back to the global `seed_tools` topics/competitors).
- **Stats row** (lines 164–167): `{author_count ?? 0} authors` and `{target_hits} target hits` (comma-formatted). `author_count` is the live count of rows in `campaign_authors` for this campaign; `target_hits` is the stored target number.

There is **no delete button** and **no run/discover button** on the card. Cards are display + edit only.

#### Create / Edit dialog (lines 174–264)
Opened by `openNew()` or `openEdit()`; title is "New Campaign" or "Edit Campaign" depending on `editingId`. Fields:

1. **Campaign name** (`Input`, line 182) — bound to `form.name`. Required.
2. **Keywords** (lines 188–216):
   - A text input (`form.keywordInput`) + an **"Add"** button (disabled unless the input has non-whitespace text).
   - `addKeyword()` (lines 48–52): trims and **lowercases** the input, ignores empties and duplicates (already in the list), appends to `form.keywords`, clears the input. Pressing **Enter** in the input also calls `addKeyword()` (and prevents form submit).
   - Helper text differs by mode: for edits it warns *"Editing keywords takes effect the next time you run discovery for this campaign — the new keywords are searched with priority."*; for new it says the keywords *"focus what writers get discovered … and are searched with priority."*
   - Each added keyword renders as a removable violet pill; the little **X** button calls `removeKeyword(kw)` (filters it out of `form.keywords`).
3. **Seed a specific writer (optional)** (lines 217–232), separated by a top border:
   - **Writer's name** input (`form.seedWriterName`).
   - **One article link by them** input (`form.seedArticleUrl`).
   - Helper: name and/or one article link → the app finds their profile and pulls in their other articles on that site; works with or without keywords (with no keywords, discovery focuses on just this writer).
4. **Sites to outreach (optional)** (lines 234–243):
   - A monospace `Textarea` (`form.seedDomains`), placeholder shows "one site per line" (e.g. `fastcompany.com`).
   - Helper: discovery mines each site's feed/sitemap for its writers, then the Email Finder digs out emails.
5. **Specific articles to outreach (optional)** (lines 245–254):
   - A monospace `Textarea` (`form.seedArticleUrls`), placeholder "one article URL per line".
   - Helper: the author of each article is pulled into the campaign, then their email is found.

**Footer buttons** (lines 256–262):
- **Cancel** → closes the dialog (`setCreating(false)`); no save.
- **Create Campaign / Save Campaign** → `handleCreateOrSave()`. Its `disabled` guard is the same as the submit validation (see below) plus `saving`. Shows a spinner while saving.

#### `handleCreateOrSave()` (lines 58–81)
1. Parses `seedDomains` and `seedArticleUrls` textareas via `parseList` (line 37): splits on newlines **and commas**, trims, drops blanks.
2. **Client-side validation** (line 61): returns early (no-op) unless `form.name` is set **and** at least one of: keywords, seed writer name, seed article URL, ≥1 parsed domain, or ≥1 parsed article URL. So a campaign must have a name and at least one discovery signal.
3. Builds the payload: `{ name, keywords, seed_writer_name: trimmed||null, seed_article_url: trimmed||null, seed_domains: [...], seed_article_urls: [...] }`. Note the UI does **not** send `region` or `target_hits`.
4. If `editingId` is set → `PATCH /api/campaigns/{editingId}`; else → `POST /api/campaigns`.
5. On `res.ok`: closes the dialog, clears `editingId`, resets the form, and re-fetches the list. On failure it silently just clears `saving` (no toast/error surfaced — see cautions).

---

### API routes / server logic

#### `GET /api/campaigns` — list campaigns
File: `src/app/api/campaigns/route.ts:4`. No params/body.
- Calls `getCampaigns()` (`queries.ts:910`): selects all `campaigns` ordered by `created_at` desc, then for **each** campaign issues a separate `count` query on `campaign_authors` (`Promise.all`) and attaches `author_count`. (N+1 count queries — one round trip per campaign.)
- **200** → JSON array of campaigns (each enriched with `author_count`).
- **500** → `{ error }` if the DB throws.

#### `POST /api/campaigns` — create campaign
File: `src/app/api/campaigns/route.ts:13`. JSON body: `{ name, keywords?, region?, target_hits?, seed_writer_name?, seed_article_url?, seed_domains?, seed_article_urls? }`.
- Computes `hasSeed = seed_writer_name || seed_article_url || seed_domains?.length || seed_article_urls?.length`.
- **400** → if `!name` OR (no keywords **and** no seed): `{ error: "name and at least one of keywords / sites / articles / seed writer are required" }`. This is the server mirror of the client guard.
- Otherwise calls `createCampaign(...)` (`queries.ts:942`): inserts with `target_hits: data.target_hits ?? 2500` and `status: "draft"`.
- **201** → the created campaign JSON.
- **500** → `{ error }` on DB failure.

#### `GET /api/campaigns/[id]` — read one
File: `src/app/api/campaigns/[id]/route.ts:4`. Path param `id` (awaited from `params`).
- Calls `getCampaign(id)` (`queries.ts:932`, `.single()`; returns `null` on error including not-found).
- **404** → `{ error: "not found" }` if null.
- **200** → the campaign JSON. (No `author_count` enrichment here — that only happens in the list endpoint.)

#### `PATCH /api/campaigns/[id]` — update one
File: `src/app/api/campaigns/[id]/route.ts:14`. Path param `id`; JSON body.
- Calls `updateCampaign(id, body)` (`queries.ts:952`) — a raw `.update(body)` on the row.
- **200** → `{ ok: true }`.
- **500** → `{ error }` on failure.
- **No field whitelist and no existence check.** Whatever keys are in the body are written straight to the `campaigns` row. The UI sends only the safe editable fields, but the route itself would happily set `status`, `target_hits`, `region`, or any other column an arbitrary caller passes. If the row doesn't exist, Supabase update matches zero rows and the route still returns `{ ok: true }` (silent no-op).

#### `POST /api/campaigns/[id]/discover` — per-campaign discovery (SSE)  ⚠ orphaned
File: `src/app/api/campaigns/[id]/discover/route.ts`. `maxDuration = 300`.
- Loads the campaign; **404** `{ error: "Campaign not found" }` if missing.
- Sets `status: "running"` on the campaign.
- Returns a **Server-Sent Events** stream (`text/event-stream`), invoking `runDiscoveryPipeline(onProgress, { campaignId: id, customKeywords: campaign.keywords })` and forwarding each progress event as `data: {json}\n\n`.
- On success emits `{ stage: "done", runId, stats }`.
- On error: sets `status: "done"` (note: **not** a failed state — see cautions) and emits `{ stage: "error", message }`. The stream is always closed in `finally`.

**Critical**: this route only passes `campaignId` and `customKeywords`. It does **not** pass `seedWriter`, `seedDomains`, or `seedArticleUrls`, so a campaign's writer/site/article seeds would be ignored here. It also does not acquire the global discovery lock, does not snapshot Redis progress, and has no QStash resume/continuation. **No UI code calls this endpoint** (grep of `src/**/*.tsx` finds zero references). The real campaign discovery path used by the app is `/api/discover` (below). Treat this file as effectively dead/legacy.

#### `/api/seeds` — global seed-tools (competitors / products / topics)
File: `src/app/api/seeds/route.ts`. These are the **global** `seed_tools` used by discovery query generation and mention detection — **distinct from a campaign's seeds**. Surfaced in the UI at `src/app/admin/page.tsx` (Admin page), not on the Campaigns page.
- **GET** → `getSeeds()`: all `seed_tools` ordered by name. Always 200.
- **POST** and **PATCH** → identical bodies `{ name, aliases?, enabled?, category? }`; both **400** `{ error: "name required" }` if no `name`, else `upsertSeed(name, aliases ?? [], enabled ?? true, category ?? "competitor")` (upsert on conflict `name`) → `{ ok: true }`. (POST and PATCH do exactly the same thing.)
- **DELETE** → body `{ id }`; **400** `{ error: "id required" }` if missing, else `deleteSeed(id)` → `{ ok: true }`.
- A `SeedTool` has `category: "our_product" | "competitor" | "topic"`. In the pipeline (`run.ts`): `our_product` names feed scoring's "our product" signal; `competitor` names become the tool list in query generation and are matched by mention detection; `topic` names are the default topic list used **only when a campaign supplies no keywords** (`queries.ts:39`).

#### `POST /api/discover` — the route that actually runs campaign discovery
File: `src/app/api/discover/route.ts`. `maxDuration = 300`. Called by the dashboard's **Run Discovery** button (`src/app/page.tsx:243`). Body: `{ campaign_id?, resume? , auto? }`.
- If `campaign_id` present on a fresh (non-resume) run (lines 64–74): loads the campaign and derives:
  - `customKeywords` = campaign keywords (or undefined if empty),
  - `seedWriter` = `{ name, articleUrl }` if `seed_writer_name`/`seed_article_url` set,
  - `seedDomains` = `campaign.seed_domains` (if any),
  - `seedArticleUrls` = `campaign.seed_article_urls` (if any),
  - and sets campaign `status: "running"`.
- Acquires a **hard global discovery lock** (`acquireDiscoveryLock`) so only one discovery runs at a time across all instances/users; refuses with `{ started: false, alreadyRunning: true }` if already locked.
- Runs the pipeline in the background via `after(...)` (independent of the request tab). On thrown error it best-effort resets the campaign to `status: "done"`.
- Response: `{ started: true, auto }` on success.
- Resume mode (`body.resume === true`) reloads the latest checkpoint (which persists `campaignId` + `customKeywords`) and continues; it does **not** re-derive/re-apply seed writer/domains/articles (those only run on a fresh run, guarded by `!isResuming` in the pipeline).

---

### How campaigns scope authors and workflows

The link between a campaign and authors is the **`campaign_authors`** join table (`campaign_id`, `author_id`, `discovered_at`). It is written by `linkAuthorsToCampaign(campaignId, authorIds[])` (`queries.ts:1024`) — chunked idempotent upserts on conflict `(campaign_id, author_id)`.

**What populates `campaign_authors`:**
1. **Campaign-scoped discovery run** (`src/lib/pipeline/run.ts:554`): after processing, it links **every** author tied to a processed article this run — the union of freshly-created author IDs (`discoveredAuthorIds`) **and** `getAuthorIdsForUrls(allHits)` (so re-discovered/pre-existing articles still get their authors linked). Then sets campaign `status: "done"`.
2. **Campaign-scoped reprocess run** (`run.ts:907`, `runReprocessPipeline` with `campaignId`): same linking logic on reprocessed hits; also flips status to `done`.
3. **Manual prospect add** (`src/app/api/prospects/manual/route.ts:77`): when a prospect is added by hand with a `campaign_id`, that author is linked.

**Important nuance:** linking is **not keyword-filtered.** A campaign's authors = whoever was discovered/processed during that campaign's run, regardless of whether they matched the campaign's keywords. Keywords only bias *which queries get generated* (see below), they do not gate which discovered authors get attached. (There is a keyword-based linker, `linkCampaignAuthorsByKeywords`, `queries.ts:776`, but it is **dead code** — not called anywhere.)

**How keywords influence discovery** (`src/lib/pipeline/queries.ts:28`): when `customKeywords` (the campaign's keywords) are present, they replace the global `topic` seeds as the "Topics/Keywords" line handed to the Claude query generator (`queries.ts:39`), so generated search queries lean toward those keywords ("searched with priority"). Competitor seeds still populate the "Tools to target" line. With no keywords, the global `topic` seeds are used instead.

**How the campaign scope is consumed downstream:**
- **Prospects** — `getProspects({ campaignId })` (`queries.ts:474`): if `campaignId` is set, it loads `campaign_authors` for that campaign and intersects (AND) it with all other filters; if the campaign has zero linked authors it short-circuits to an empty result. Exposed via `GET /api/prospects?campaign_id=...`.
- **Workflows** — `getWorkflows(campaignId)` (`queries.ts:1037`) filters workflows to `campaign_id`; `Workflow.campaign_id` optionally ties a workflow to a campaign. Exposed via `GET /api/workflows?campaign_id=...`. Workflows further filter *within* a campaign's authors.
- **Score stats** — `getScoreStats(campaignId)` (`queries.ts:968`): computes count/min/max/avg/median composite over just the campaign's authors (best composite per author), used by the workflow filter UI to guide the min-score threshold. Exposed via `GET /api/score-stats?campaign_id=...`.
- **Email Finder** — `email-finder/page.tsx` selects a `campaign_id` and scopes pending-email counts + enrichment runs to that campaign (`/api/enrich/pending?campaign_id=...`).
- **Dashboard discovery dropdown** (`src/app/page.tsx:430`): a `<select>` (only shown when campaigns exist) sets `discoveryCampaignId`; "No campaign" = empty = unscoped run. Below it, the selected campaign's keyword badges are shown (`page.tsx:471`), and a live campaign prospect count is fetched (`page.tsx:203`). "Run Discovery" posts `campaign_id: discoveryCampaignId` to `/api/discover`.

---

### Key checks & validations

- **Create requires name + ≥1 signal** — enforced both client-side (`page.tsx:61`) and server-side (`route.ts:18`): name plus at least one of keywords / seed writer name / seed article URL / seed domains / seed article URLs.
- **Keyword normalization** — added keywords are trimmed + lowercased and de-duplicated at input time (`addKeyword`, `page.tsx:48`).
- **List parsing** — `seed_domains`/`seed_article_urls` textareas split on newlines and commas, trimmed, blanks dropped (`parseList`, `page.tsx:37`).
- **Discovery-time URL validation** — in the pipeline, `seedArticleUrls` are filtered to `^https?://` (`run.ts:220`); `seedDomains` are normalized to bare hosts (strip scheme/`www`/path, lowercase) (`run.ts:159`). No such validation happens at campaign-save time — any junk text is stored and only cleaned/validated when a run consumes it.
- **`getCampaign` 404 semantics** — returns `null` on *any* Supabase error (not only not-found), which the `[id]` GET maps to 404 and `[id]/discover` maps to "Campaign not found".
- **Auth** — none of the campaign or seed route handlers do their own auth. Access is gated globally by `src/proxy.ts` (Next.js 16's proxy = middleware): every path except `/api/auth`, `/api/health`, the `CRON_SECRET` Bearer/`?key=` callers, and `/login` requires a logged-in session (`auth()`), else redirect to `/login`. So the API is protected only insofar as the proxy runs.

---

### Flows

**Flow A — Create a campaign**
1. User clicks **New Campaign** (or the empty-state button) → dialog opens in create mode.
2. Enters a name, adds keywords (Enter/Add), optionally fills seed writer / sites / article URLs.
3. Clicks **Create Campaign** → `handleCreateOrSave()` validates, builds payload, `POST /api/campaigns`.
4. Server validates (name + ≥1 signal) → `createCampaign` inserts with `status: "draft"`, `target_hits: 2500` → 201.
5. UI closes dialog, resets form, re-fetches list; the new card appears with a **Draft** badge and 0 authors.

**Flow B — Edit a campaign**
1. User clicks the **Pencil** on a card → dialog opens pre-filled (`openEdit`), title "Edit Campaign".
2. User changes keywords/seeds → **Save Campaign** → `PATCH /api/campaigns/{id}` with the same payload shape.
3. `updateCampaign` writes the fields; UI re-fetches. New keywords take effect on the *next* discovery run.

**Flow C — Run discovery for a campaign (the real path)**
1. On the Prospects/dashboard page, user picks the campaign in the **discovery dropdown** (`discoveryCampaignId`).
2. Clicks **Run Discovery** → `POST /api/discover { campaign_id }`.
3. Route takes the global lock, loads the campaign, derives `customKeywords` + `seedWriter` + `seedDomains` + `seedArticleUrls`, sets campaign `status: "running"`, and launches `runDiscoveryPipeline` via `after()`.
4. Pipeline: mines campaign `seedDomains` (RSS/sitemap) always in full; queues `seedArticleUrls` as discovery hits; resolves the `seedWriter` and harvests their archive; runs keyword-biased query rounds (unless it's a writer-only campaign with no keywords, which skips the keyword loop); processes hits into authors/articles/scores.
5. After processing, links **all** discovered authors for the run to the campaign (`campaign_authors`) and sets `status: "done"`; then kicks off automatic email finding via QStash.
6. UI shows the campaign card flip to **Running** then **Done**, and `author_count` grows.

**Flow D — Use a campaign downstream**
1. Prospects page: filter by campaign → `getProspects({ campaignId })` returns only that campaign's linked authors.
2. Workflows page: create a workflow tied to `campaign_id`; `getScoreStats(campaign_id)` guides the score threshold; the workflow selects/ranks prospects from within the campaign.
3. Email Finder: scope enrichment to the campaign to dig out just those authors' emails.

---

### Edge cases & cautions

- **`/api/campaigns/[id]/discover` is orphaned and lossy.** It is not referenced by any UI code, and even if called it only forwards `campaignId` + `customKeywords` — it silently ignores the campaign's seed writer, seed domains, and seed article URLs, and skips the global lock, Redis progress snapshotting, and QStash resume. Do not treat it as the campaign discovery entrypoint; `/api/discover` is. If someone wires a "Run" button on the campaign card to this route, seed-based campaigns will silently under-deliver.
- **PATCH has no field whitelist / no existence check.** `updateCampaign(id, body)` writes the raw body to the row. A crafted request can set `status`, `region`, `target_hits`, or any column. Updating a non-existent id returns `{ ok: true }` while changing nothing (silent no-op). Any future editable-field additions must be validated here.
- **Campaign author linking is run-scoped, not keyword-scoped.** Every author processed during a campaign run is attached to the campaign regardless of keyword relevance. Because discovery also runs the global RSS/harvester set, a keyword campaign's `author_count` reflects the *whole run's* output, not authors that matched the keywords. The keyword-only linker `linkCampaignAuthorsByKeywords` exists but is never called.
- **Only one discovery at a time, globally.** The global lock in `/api/discover` means a campaign run blocks all other discovery (and vice-versa). Two users can't run discovery for two campaigns simultaneously; the second gets `alreadyRunning`.
- **`status` can get stuck / is coarse.** Status is flipped to `running` at start and `done` at the end (or on error) — there is no `failed` campaign status. If a process dies without hitting the pipeline's finally/catch (e.g. hard timeout mid-work with no continuation), a campaign can be left showing **Running** indefinitely. The `[id]/discover` error branch also sets `done` (not an error state), masking failures.
- **`target_hits` is largely cosmetic.** It defaults to 2500 and is displayed, but there is no campaign-level enforcement; the pipeline's `TARGET_NEW_HITS` is a global 2500 per run, unrelated to this field. The UI never lets you set it.
- **`region` is effectively vestigial** — accepted by API/DB, never set by the UI, and not used to constrain discovery.
- **No delete.** There is no campaign delete route or UI. Removing a campaign (and cleaning its `campaign_authors`) requires direct DB access.
- **Silent save failures in the UI.** `handleCreateOrSave` only acts on `res.ok`; a 400/500 response just clears the saving spinner with no toast or inline error, so a user may not know a save failed.
- **N+1 counts on list.** `getCampaigns` issues one `campaign_authors` count query per campaign; with many campaigns this is many round trips on every page load.
- **Global `/api/seeds` vs campaign seeds are different things.** Editing the global seed tools (Admin page) changes discovery for *all* unscoped/keyword-less runs; it does not edit any campaign. Don't conflate "seed tools" (competitors/products/topics) with a campaign's "seed writer/sites/articles".
- **Auth depends entirely on the proxy.** The route handlers trust that `src/proxy.ts` already required a session. Campaigns are not scoped to a `user_id`, so every authenticated user sees and can edit every campaign; there is no per-user isolation.

---

## Workflows (Prospect Lists)

### Purpose

A **workflow** is a saved, curated list of prospects (article authors) that you intend to email. It is the bridge between the raw prospect database and the outreach machinery: you define filters, "run" them to materialize a ranked prospect list, hand-tune that list (add/remove/select individuals, drop whole publications), and then generate + send emails from it. A workflow optionally belongs to a **campaign** (which scopes its candidate pool to that campaign's authors); with no campaign it draws from *all* prospects across every campaign.

Key backing tables: `workflows` (the definition + saved `filters` + `status` + cached `prospect_count`) and `workflow_prospects` (the materialized membership rows: `workflow_id`, `author_id`, `included`, `rank`). Everything on this page revolves around those two tables.

The whole UI lives in one client component: `src/app/workflows/page.tsx`.

---

### UI walkthrough

The page is a full-height two-pane layout (`src/app/workflows/page.tsx:453`): a fixed 256px **sidebar** listing workflows, and a **main panel** showing the selected workflow's prospects.

#### Sidebar (`page.tsx:456`)

- **Header** — "Workflows" label plus a ghost `+` button (`page.tsx:459`) that opens the *New Workflow* dialog (`setCreating(true)`).
- **Search box** — only rendered when there are **more than 6** workflows (`page.tsx:463`). Filters the list client-side by name substring (case-insensitive), via `wfMatch` (`page.tsx:447`).
- **Grouped list** — workflows are grouped by campaign (`grouped`, `page.tsx:448`). Each campaign that has at least one matching workflow gets an uppercase header (the campaign name) followed by its workflows. Workflows with no `campaign_id` fall under a **"No campaign"** group (`uncampaigned`, `page.tsx:451`). Each row shows a `GitBranch` icon, the workflow name (truncated), and — for campaigned rows only — the cached `prospect_count` as a small number (`page.tsx:492`). Clicking a row calls `selectWorkflow(wf)`.
- **Empty/loading states** — a spinner while `loading`; "No workflows yet" when there are none (`page.tsx:512`); "No workflows match "…"" when a search filters everything out (`page.tsx:517`).

#### Main panel — empty state (`page.tsx:529`)

When no workflow is selected: a centered `GitBranch` icon, the text "Select a workflow from the sidebar, or create a new one", and a **New Workflow** button.

#### Main panel — workflow header (`page.tsx:540`)

Shows the workflow name, and a subtitle line: `campaign name (or "No campaign") · {total} prospects · <StatusBadge>`. `total` here is the server-reported total membership count, not the number of rows currently rendered.

- **StatusBadge** (`page.tsx:19`) — `ready` → green "Ready"; `running` → amber "Running" with a spinner; anything else (`draft`) → outline "Draft".
- **Export List** button (`page.tsx:547`) — opens `/api/workflows/{id}/export` in a new tab to download a CSV. Disabled when `total === 0`.
- **Filters** button (`page.tsx:557`) — opens the right-hand Filter Sheet (`setShowFilters(true)`).
- **Run Workflow** button (`page.tsx:565`) — calls `runWorkflow()`; shows "Running…" with a spinner while `running`.

#### Filter Sheet + FilterPanel (`page.tsx:731`, `FilterPanel` at `page.tsx:29`)

Opens as a right-side sheet titled "Workflow Filters". It renders `<FilterPanel>` bound to the local `filters` state, plus a full-width **Apply & Run** button at the bottom (`page.tsx:738`) that closes the sheet and calls `runWorkflow()`. Every field edits the in-memory `filters` object; nothing is persisted until you Run (Run first PATCHes the filters, then runs — see Flows).

The panel exposes exactly these controls (`WorkflowFilters` type at `src/lib/types.ts:217`):

1. **Min score** (`page.tsx:37`) — numeric input (0–100), sets `filters.minScore`. Empty clears it (`undefined`). Below it, when `scoreStats` is loaded and non-empty, a distribution hint renders: **low / median / avg / high** and "across N scored prospects" (`page.tsx:45`). Stats come from `GET /api/score-stats?campaign_id=…` (see below), scoped to the workflow's campaign.
2. **Max prospects** (`page.tsx:56`) — numeric input (min 1, placeholder 200), sets `filters.limit`. This is the hard cap on how many prospects `runWorkflowFilters` materializes.
3. **Article type** (`page.tsx:66`) — native `<select>` over `ARCHETYPES` = `["", listicle, review, comparison, tutorial, opinion, roundup]` (`page.tsx:25`). Empty = "Any". Sets `filters.archetype`.
4. **Email** (`page.tsx:76`) — native `<select>`, sets `filters.emailStatus`. Options: `any` (Any), `has` (Has email), `verified` (Found / sourced), `guessed` (Guessed (pattern)), `none` (No email), `linkedin_no_email` (Has LinkedIn, no email).
5. **Sort direction** (`page.tsx:91`) — `<select>` sets `filters.sortDir`: `desc` = "Highest score first" (default), `asc` = "Lowest score first".
6. **Tool filter** (`page.tsx:101`, spans 2 columns) — free-text input (e.g. "Midjourney"), sets `filters.tool`. Matched with `ilike %tool%` against `mentions.tool_name`.
7. **Only not-yet-emailed prospects** (`page.tsx:109`) — checkbox, sets `filters.notContacted`. When checked, excludes anyone already contacted anywhere (respecting overrides).

Note: the `WorkflowFilters` type also declares `hasContact`, `region`, and `minArticles`, but the panel does **not** surface them. `region` and `hasContact` are still honored by `runWorkflowFilters`; `minArticles` is defined but never read anywhere (dead field).

#### Prospect controls bar (`page.tsx:575`)

A toolbar above the list:

- **Search** input (`page.tsx:578`) — filters the *currently loaded* rows client-side by author full name or publication (`filteredProspects`, `page.tsx:397`). Purely visual; does not hit the server.
- **Add prospect** button + popover (`page.tsx:586`) — toggles an inline search popover for adding *individual* prospects from the whole database. See "Manual/search add" flow.
- **AI find** button (`page.tsx:636`) — opens the AI find dialog.
- **Check sites DR** button (`page.tsx:639`) — opens the sites dialog. Disabled when there are no loaded prospects.
- **Selection counter** (`page.tsx:642`) — "`{includedCount} of {prospects.length} selected`". If any loaded prospect is contacted-elsewhere, appends an amber "`· {contactedCount} already contacted (excluded)`".
- **Select all / Deselect all** (`page.tsx:646`) — toggles `toggleAll`. Label flips based on `allSelectableIncluded`. Disabled when there are no *selectable* (non-contacted) prospects. Crucially this only counts/acts on **selectable** prospects (contacted-elsewhere ones are neither counted nor toggled).
- **Remove all** (`page.tsx:655`) — red button, calls `removeAll()` after a `confirm()`. Disabled when the list is empty.

#### Prospect list + ProspectRow (`page.tsx:660`, row at `page.tsx:122`)

States:
- Loading spinner while `prospectsLoading`.
- If nothing loaded at all: "No prospects yet — run the workflow to generate them" plus a **Run Workflow** button (`page.tsx:668`).
- If loaded but the client search matches nothing: "No results match your search".
- Otherwise renders one `ProspectRow` per prospect.

Each **ProspectRow** shows:
- A **checkbox** (`page.tsx:144`). Checked = `p.included && !contacted`. **Disabled entirely when the prospect is contacted-elsewhere.** Toggling calls `toggleProspect(author_id, checked)`.
- The whole row is dimmed (`opacity-50`) when it is either not-included or contacted.
- **Avatar** (image or 2-letter initials fallback).
- **Name button** (`page.tsx:156`) — clicking opens the ProspectDrawer for that author (`openAuthor`). Below it, the publication (`domain.name` → `domain.host` → "Unknown").
- **Right-side badges/icons** (`page.tsx:165`):
  - **contacted** badge (amber, `page.tsx:166`) — only when contacted-elsewhere. Tooltip: "Already emailed or in an active thread in another campaign — excluded from this send. Open the profile to allow emailing them again."
  - **LinkedIn** link icon — when a `linkedin` contact exists; opens the profile URL.
  - **email** badge — green "email" for a real/sourced email, amber "email · guess" when `isGuessSource(source)` is true (source is `pattern` or `pattern-catchall`, per `src/lib/enrich/personFilter.ts:47`).
  - **Score** — the composite, colored green ≥70 / amber ≥40 / muted below.
  - **`#rank`** — the prospect's rank within the workflow.
  - **Trash icon** (`page.tsx:188`) — `onRemove` → `removeProspect(author_id)` (removes from the workflow entirely, not just deselect).

#### New Workflow dialog (`page.tsx:692`)

- **Workflow name** text input (required).
- **Campaign (optional)** — a `SearchableSelect` over all campaigns; the "none" option reads "All prospects (no campaign filter)".
- **Cancel** / **Create**. Create is disabled until a name is entered or while `saving`. On success it closes, refreshes the list, and auto-selects the new workflow.

#### Check sites DR dialog (`page.tsx:750`)

Titled "Sites in this workflow ({N})". Computes `sites` (`page.tsx:416`): the **unique set of websites** across all loaded prospects — each prospect's primary `domain` **plus** the domain of every article they wrote. Deduped by host (stripping `www.`), carrying a Domain Rating (`d.dr`) and the set of prospect author IDs that touch each host. Sorted by DR descending (nulls last).

Each row: a **checkbox**, the host as an external link, a **DR badge** (`DR {rounded}`, green when ≥50; "DR —" when unknown), and "`{n} prospect(s)`". The checkbox is **checked** only when *every* prospect who wrote on that site is currently `included`. Unchecking calls `toggleSite(authorIds, false)`, which deselects (sets `included=false`) every prospect touching that host — so they won't be emailed. Footer shows "`{X} of {N} sites active`". Empty state: "No sites yet — add prospects first."

Caution: DR shown here is `domain.dr`, whereas the CSV export's "Domain rating" column uses `domain.dr_proxy_score` — two different fields, so the two views can disagree.

#### AI find dialog (`page.tsx:783`)

Lets you describe the writers you want in plain English; an LLM extracts keywords, then the whole database is searched.

- **Prompt** textarea (`page.tsx:790`).
- **Include people already contacted** checkbox → `aiIncludeContacted` (default off).
- **Include guessed emails (not just verified)** checkbox → `aiIncludeGuessed` (default **on**).
- Fine print: "Only people who have an email are returned."
- **Search** button → `runAiSearch()` (`page.tsx:372`).
- After a search: the extracted **keywords** render as pills (`page.tsx:805`); a summary line "`{aiTotal} matching prospect(s) with an email (showing {n})`"; then a scrollable results list. Each result shows the author name (opens the drawer), publication + composite score, the **referencing article** title (the article whose title/excerpt/text contains a keyword, else the newest article), an "article" external link, and a green "email" or amber "guessed" badge.
- Empty result: "No matching prospects with an email. Try broader wording or enable guessed emails."
- Footer **Add all** button (`page.tsx:851`) — `addAllAi()`. Disabled while adding, when there are 0 results, or when no workflow is selected. Label: "Add all ({shown}{ of total}) to workflow".

#### ProspectDrawer (`src/components/prospects/ProspectDrawer.tsx`)

Opened from any name click via `useAuthorDrawer` (`src/components/prospects/useAuthorDrawer.tsx`), which fetches `GET /api/authors/{id}` and renders the shared drawer. Relevant to workflows are its two toggle rows:

- **Emailed** toggle (`ProspectDrawer.tsx:133`) — a `Switch` reflecting the author's *effective* contacted state. On open it fetches `GET /api/authors/{id}/contacted`. Toggling calls `PATCH /api/authors/{id}/contacted` with `{ contacted: true|false }`. `true` = "won't be contacted again"; `false` = "eligible for outreach" (i.e. **email them again** — overrides derived history). This writes `authors.contacted_override`. This is exactly how you re-enable emailing someone the contacted-exclusion has hard-dropped.
- **Discarded** toggle (`ProspectDrawer.tsx:149`) — a `Switch` writing `PATCH /api/authors/{id}/discard`. When on, the author is hidden from **every** workflow (`runWorkflowFilters` always excludes discarded authors).

The drawer also has score breakdown, safety screening, contacts, a "Re-find email" action, tools, articles, and provenance — documented elsewhere.

---

### API routes / server logic

#### `GET /api/workflows` — list (`src/app/api/workflows/route.ts:4`)
- Query: optional `campaign_id`. Delegates to `getWorkflows(campaignId)` (`queries.ts:1037`), which selects all workflows joined with `campaign:campaigns(id,name)`, newest first, optionally filtered by campaign.
- Responses: `200` array; `500 {error}` on throw.

#### `POST /api/workflows` — create (`route.ts:15`)
- Body: `{ name, campaign_id?, filters? }`. **`name` required** → `400 {error:"name required"}` if missing.
- Calls `createWorkflow` (`queries.ts:1058`), which inserts with `filters ?? {}` and `status: "draft"`, returning the row joined with its campaign.
- Responses: `201` workflow; `400`; `500`.
- The UI always sends default filters `{ notContacted: true, emailStatus: "has" }` on create (`page.tsx:281`).

#### `GET /api/workflows/[id]` (`src/app/api/workflows/[id]/route.ts:4`)
- `getWorkflow(id)`; `404 {error:"not found"}` if the row isn't found (`.single()` error → null). Otherwise `200`.

#### `PATCH /api/workflows/[id]` (`[id]/route.ts:14`)
- Body is passed straight to `updateWorkflow(id, body)` (`queries.ts:1068`), which updates whatever keys are present (`name`, `filters`, `status`, `prospect_count`). No allow-listing — any column in the body is written.
- Responses: `200 {ok:true}`; `500 {error}`.

#### `POST /api/workflows/[id]/run` — materialize the list (`[id]/run/route.ts:4`)
- Loads the workflow (`404` if missing).
- Sets `status: "running"`.
- Calls `runWorkflowFilters(workflow.filters ?? {}, workflow.campaign_id)` → returns `{author_id, rank}[]`.
- Maps each to `{...p, included: true}` and calls `saveWorkflowProspects(id, rows)`, which **deletes all existing** `workflow_prospects` for the workflow then bulk-inserts the new set in chunks of 500 (`queries.ts:1073`).
- Sets `status: "ready"` and `prospect_count = rows.length`.
- Response: `200 {count}`. On any error: sets status back to `draft` (best-effort) and returns `500 {error}`.
- **Destructive:** running replaces the entire membership. Any manual adds and any include/exclude tuning from a previous run are wiped.

#### `GET /api/workflows/[id]/prospects` — page the list (`prospects/route.ts:4`)
- Query: `offset` (default 0), `limit` (default 50). The UI always requests `limit=200` (`page.tsx:252`).
- `getWorkflowProspects` (`queries.ts:1130`) returns `{ prospects, total }`. `total` is an exact head-count of all membership rows (not limited); `prospects` is the page, ordered by `rank` asc, deeply hydrated: author + domain + contacts + articles (with mentions + article domain) + best score.
- Responses: `200 {prospects,total}`; `500 {error}`.

#### `POST /api/workflows/[id]/prospects` — add (`prospects/route.ts:22`)
- If body has `author_ids: string[]` → **bulk add** via `addWorkflowProspects` (`queries.ts:1088`): dedups, re-includes any already present, appends the rest ranked after the current max rank, chunked 500 at a time. Returns `{ok:true, added}`.
- Else requires `author_id` (`400` if absent) → `addWorkflowProspect` (`queries.ts:1117`): if present, sets `included=true`; else inserts at `maxRank+1`.
- `500 {error}` on throw.

#### `PATCH /api/workflows/[id]/prospects` — bulk include/exclude (`prospects/route.ts:44`)
- Body `{ included: boolean, author_ids?: string[] }`. Calls `setWorkflowProspectsIncluded(id, included===true, author_ids?)` (`queries.ts:1231`): updates `included` for the whole workflow, or just the given author IDs. **Omitting `author_ids` affects every membership row** — including ones not currently loaded in the UI.
- Powers Select all / Deselect all and the sites toggle. `500` on throw.

#### `DELETE /api/workflows/[id]/prospects` — clear all (`prospects/route.ts:59`)
- `removeAllWorkflowProspects(id)` (`queries.ts:1112`): deletes every membership row, returns count removed. `200 {ok:true, removed}`.

#### `PATCH /api/workflows/[id]/prospects/[aid]` — toggle one (`prospects/[aid]/route.ts:4`)
- Body `{ included }` → `toggleWorkflowProspect(id, aid, Boolean(included))` (`queries.ts:1220`). `200 {ok:true}`; `500`.

#### `DELETE /api/workflows/[id]/prospects/[aid]` — remove one (`prospects/[aid]/route.ts:19`)
- `removeWorkflowProspect(id, aid)` (`queries.ts:1107`): deletes that one membership row. `200 {ok:true}`; `500`.

#### `GET /api/workflows/[id]/export` — CSV (`export/route.ts:11`)
- Loads the workflow + up to 5000 prospects. Emits a CSV with columns: Name, Publication, Website (`https://{host}`), **Domain rating (`domain.dr_proxy_score`)**, Email (mailto stripped), LinkedIn, Articles (count), Article links (joined by ` | `). UTF-8 BOM prepended for Excel. Filename `blog-list_{slug}.csv`. Always `200 text/csv` (no auth/existence guard — a missing workflow just yields a sheet with a "workflow" filename and whatever prospects match the id, which will be none).

#### `GET /api/score-stats` (`src/app/api/score-stats/route.ts`)
- Query `campaign_id?`. `getScoreStats` (`queries.ts:968`): best composite per author across the pool (campaign authors, or all), returning `{count,min,max,avg,median}`. Feeds the min-score hint.

#### `POST /api/prospects/ai-search` (`src/app/api/prospects/ai-search/route.ts`)
- `maxDuration = 120`. Body `{ prompt, includeContacted?, includeGuessed?, limit? }`. Empty prompt → `400`.
- `extractKeywords(prompt)`: if `OPENROUTER_API_KEY` is set (≥20 chars), calls OpenRouter `anthropic/claude-haiku-4-5` (20s timeout, temp 0.3) with a prompt that asks for a generous 6–15 keyword set including synonyms and competitor tools, keeping product names intact. On any failure / no key / bad JSON it falls back to a **naive** tokenizer (lowercase, strip punctuation, drop words ≤3 chars and stopwords, cap 12).
- Calls `aiProspectSearch` (`queries.ts:786`), limit `min(1000, body.limit || 500)`. Response `{keywords, prospects, total, matchedAuthors}`; `500` on throw.
- `aiProspectSearch` → `matchAuthorIdsByKeywords` (`queries.ts:727`): matches authors across **article titles (strong)**, article excerpt/body (weak), **tool mentions (strong)**, author name/bio (weak), and publication name (weak). Keywords are sanitized for PostgREST `.or()` and **capped at 12**. Strong matches (title or tool mention) are floated to the top. Then `getProspects` is called with `restrictIds` = matched authors, `excludeIds` = contacted authors (unless `includeContacted`), `emailStatus` = `verified` (or `has` if `includeGuessed`), `excludeDiscarded: true`. So AI find always returns only email-having, non-discarded authors.

#### `GET /api/prospects` (`src/app/api/prospects/route.ts`)
- The general prospect index (also used by the *Add prospect* popover with `search`, `limit=15`, `exclude_discarded=true`). Supports `minScore`, `archetype`, `tool`, `hasContact`, `email_status`, `search`, `sortBy`, `campaign_id`, `exclude_discarded`, `qualified_only`, `min_dr`, and an `include` param for stats/charts. Delegates to `getProspects` (`queries.ts:436`). `500 {error}` on throw.

#### `POST /api/prospects/manual` (`src/app/api/prospects/manual/route.ts`)
- Manually create a prospect. **Not exposed on the workflows page** (it's triggered from the main Prospects dashboard, `src/app/page.tsx`), but authors created here become addable to workflows.
- Body `{ full_name, email?, publication?, publication_name?, article_urls: string[] | article_url?, campaign_id? }`.
- Validations: `full_name` required (`400`); at least one **`https://` article link** required (`400` "At least one article link…") — dedup + protocol-filtered; a publication domain must be derivable from explicit field → email domain → first article host, else `400`.
- Creates/upserts domain + author (`source:"manual"`, `role:"writer"`), each article (deduped by canonical URL, linked to author), an optional email contact (`confidence:1, source:"manual", verified_syntax:true`), a **seed score of 50** across the board so it surfaces in sorted lists, and optionally links to a campaign. `200 {ok:true, author_id, articles}`; `500`.

#### `GET /api/outreach/contacted` (`src/app/api/outreach/contacted/route.ts`)
- Query `exclude_workflow?`. Returns `{ authorIds: [...] }` from `getContactedAuthorIds(exclude)`. The workflow UI calls it with `exclude_workflow={current}` so a prospect isn't flagged "contacted" just because *this* workflow already queued them (`page.tsx:270`).

#### `GET`/`PATCH /api/authors/[id]/contacted` (`src/app/api/authors/[id]/contacted/route.ts`)
- `GET` → `isAuthorContacted(id)` returns `{contacted, override, hasHistory}`.
- `PATCH {contacted: true|false|null}` → `setContactedOverride` (`true` never-again, `false` email-again, `null` revert to derived), then returns fresh state. Backs the drawer's Emailed toggle.

---

### `runWorkflowFilters` in depth (`queries.ts:1241`)

The heart of "Run". Builds an intersection of author-ID sets, then orders by score:

1. **Candidate pool** — if `campaignId`, start from `getCampaignAuthorIds`; **if that campaign has zero authors, return `[]` immediately**.
2. Each active filter contributes a `Set<string>`, all AND-intersected:
   - `minScore > 0` → authors with any `scores.composite >= minScore`.
   - `tool` (and `!== "all"`) → mentions `ilike %tool%` → their articles → their authors. **If no mentions match, returns `[]`.**
   - `archetype` (and `!== "all"`) → articles with that archetype → authors. **Empty → `[]`.**
   - `hasContact` → authors with any `type="mailto"` contact.
   - `emailStatus`:
     - `has` → any mailto.
     - `guessed` → mailto with a guess source (`pattern`/`pattern-catchall`).
     - `verified` → mailto **not** a guess.
     - `none` → all authors minus those with a mailto.
     - `linkedin_no_email` → authors with a `linkedin` contact but no mailto.
   - `notContacted` → all authors minus `getContactedAuthorIds()` (respects overrides).
   - `region` → domains whose `country ilike %region%` → their authors. **Empty domain match → `[]`.**
3. **Intersection**: if no filter sets at all, the pool is *all* authors. Otherwise it intersects starting from the smallest set for efficiency.
4. **Always drops discarded authors** (`authors.discarded = true`) regardless of filters (`queries.ts:1363`).
5. If the surviving set is empty → `[]`.
6. **Ordering**: pulls all `scores` ordered by `composite` (asc if `sortDir==="asc"`, else desc), keeps the first occurrence per author in that order, then **appends authors with no score row** at the end.
7. **Caps at `filters.limit ?? 200`**, assigns `rank = i+1`.

Note `notContacted` here uses the *global* `getContactedAuthorIds()` (no workflow exclusion) — so running a workflow with "only not-yet-emailed" excludes people this very workflow already emailed too.

---

### The contacted-exclusion model (`getContactedAuthorIds`, `queries.ts:1891`)

This is the system's core guard against emailing the same person/inbox twice, and it is **email-address-aware and cross-campaign**:

1. **Durable history**: an author counts as contacted if they have any `outreach_emails` row matching `status in (sent,scheduled) OR sent_at NOT NULL OR replied_at NOT NULL OR bounced_at NOT NULL`. Using durable timestamps (not just status) matters because *regenerating* an email resets status to `ready` but leaves `sent_at`/`replied_at` intact — status alone would wrongly "forget" someone already emailed.
2. **`excludeWorkflowId`**: rows belonging to that workflow are ignored, so a prospect isn't self-flagged by the workflow you're currently viewing/sending.
3. **Shared-inbox / email-level propagation** (`queries.ts:1905`): the unit contacted is an *inbox*, not a person. It collects every mailto address of the already-contacted authors, then pulls in **any other author who shares one of those addresses** (common with shared editorial inboxes like `tips@`). Both get flagged so the same address is never hit twice.
4. **Manual overrides win** (`queries.ts:1926`): `authors.contacted_override = true` forces contacted; `= false` forces NOT contacted ("email them again"); `null` = fall back to derived history. Overrides are applied last, overriding steps 1–3.

`isAuthorContacted` (`queries.ts:1952`) computes the single-author version (used by the drawer + `GET /api/authors/[id]/contacted`) with the same shared-inbox logic, and `getAuthorDetail` (`queries.ts:1200`) derives `contacted` the same way for the full author payload.

**Where it's enforced** (three places, all using the *same* function so they agree):
- **Build/generate** — `POST /api/workflows/[id]/generate-emails` (`generate-emails/route.ts:135,194`) and `/generate-linkedin` (`generate-linkedin/route.ts:87,128`) only generate for `p.included && !contactedElsewhere.has(author_id)`. If that count is 0, they return `{started:false, total:0, reason:"No new prospects to generate (already contacted or none selected)."}` without starting.
- **Send** — `POST /api/workflows/[id]/send` (`send/route.ts:75-95`) filters the sendable set to included + ready/scheduled + not-contacted-elsewhere + has-a-real-mailto. Contacted ones are counted as `skippedContacted`. If nothing is sendable, it returns a `reason` (either "All candidates were already contacted…" or "No ready emails…"). **Test mode** (`to_override` present) bypasses both the contacted-elsewhere and real-email guards so a test always sends.
- **UI (display only)** — the list fetches `contactedElsewhere` and renders those rows disabled + unchecked + dimmed, excludes them from the selected/`includedCount` and from Select-all's target set (`page.tsx:405-411`). This mirrors the server so the visible list never overlaps people already reached.

---

### Key checks & validations

- Create requires a non-empty `name` (client disables the button; server `400`s).
- Manual add requires `full_name` + at least one `https://` article link + a derivable domain.
- AI search requires a non-empty prompt; returns only authors *with an email* (verified, or guessed if opted in) and non-discarded.
- Running a campaign-scoped workflow with an empty campaign, or any filter that matches nothing, yields an empty list (several early `return []` paths).
- Discarded authors are unconditionally excluded from `runWorkflowFilters` and from `getProspects` when `excludeDiscarded` is set (AI search always sets it).
- "Email/has email" everywhere means specifically a `mailto` contact — **not** any social handle.
- Contacted-exclusion is enforced server-side at generate and send; the checkbox state in the UI cannot bypass it (a checked contacted prospect is still hard-dropped).

---

### Flows

**Create → run → tune → (hand off to outreach):**
1. Click `+` → fill name + optional campaign → Create. POST `/api/workflows` with default filters `{notContacted:true, emailStatus:"has"}`. New workflow auto-selected (`handleCreate`, `page.tsx:274`).
2. `selectWorkflow` (`page.tsx:261`) sets local filters from the saved workflow, fetches prospects (`limit=200`), fetches score-stats (campaign-scoped), and fetches contacted-elsewhere (`exclude_workflow=this`).
3. Open Filters, adjust, **Apply & Run** (or the header Run). `runWorkflow` (`page.tsx:293`) first `PATCH`es `{filters}` to persist them, then `POST /run`. On success it updates local status→ready, `prospect_count`, and re-fetches the list.
4. Tune: toggle individual checkboxes (`toggleProspect` → PATCH one), Select/Deselect all (`toggleAll` → PATCH with no `author_ids`), remove one (trash → DELETE one), remove all (→ DELETE all), or uncheck a whole site in the DR dialog (`toggleSite` → PATCH with `author_ids`).
5. Add more: "Add prospect" search (`runAddSearch` hits `/api/prospects?search=…&exclude_discarded=true`, `addToWorkflow` → POST one) or "AI find" (`runAiSearch` → `/api/prospects/ai-search`, `addAllAi` → POST `{author_ids}`). Both re-fetch the list after.
6. Downstream: generate emails/LinkedIn notes and send — each independently re-applies the contacted-exclusion against the *included* set.

**Data flow of a run:** `filters` (persisted) → `runWorkflowFilters` intersects filter sets over the candidate pool, drops discarded, orders by composite, caps at `limit` → `saveWorkflowProspects` wipes + reinserts membership with `included:true, rank` → `prospect_count` cached on the workflow.

---

### Edge cases & cautions

- **Run is destructive.** `saveWorkflowProspects` deletes the entire existing membership first. All manual adds and all include/exclude tuning are lost on every Run. Re-running "resets" the list to the filter output. Manual curation should happen *after* the final run.
- **UI loads only 200 rows** (`limit=200`), but **Select all / Deselect all** with no `author_ids` operates on *every* membership row in the DB — including the ones not loaded. Similarly `runWorkflowFilters` defaults to 200 (`filters.limit ?? 200`). So the on-screen list is capped at 200 unless you raise Max prospects, yet bulk actions still reach beyond it. The header's `total` reflects the true count; `prospects.length` (used in "X of Y selected", Remove-all disabling, sites) reflects only what's loaded.
- **`contactedCount`, `includedCount`, and the sites list are computed from loaded rows only.** With >200 members these undercount.
- **Select all deliberately ignores contacted prospects** — `allSelectableIncluded` and `includedCount` are over `selectableProspects` (non-contacted). This is intentional so the list never re-selects already-reached people, but it means "Select all" won't check a contacted row even though the checkbox is just disabled (not removed from the list).
- **No auth checks** on any workflow route. Every route trusts the caller; there's no per-user ownership check. The export route additionally has no existence guard.
- **`updateWorkflow` writes whatever body it's given** — `PATCH /api/workflows/[id]` has no field allow-list; a malformed body could set unexpected columns (Supabase will reject unknown columns, surfacing as a `500`).
- **DR field mismatch**: the "Check sites DR" popup reads `domain.dr`; the CSV export's "Domain rating" reads `domain.dr_proxy_score`. They can disagree, and either may be null.
- **`minArticles` filter is dead** — declared in `WorkflowFilters` but never consumed by `runWorkflowFilters`. `region`/`hasContact` are honored server-side but not exposed in the panel.
- **AI keyword cap**: `matchAuthorIdsByKeywords` caps at 12 sanitized keywords for the single-shot call, and characters `,()%_*` are stripped (they break PostgREST's `.or()`). A prompt yielding many product names may silently drop some. The `ilike %kw%` matching can also over-match (substring), e.g. a short keyword hitting unintended articles.
- **AI find "Add all" adds the shown page**, mapped from `aiResults` (default up to 500). If `aiTotal > aiResults.length`, only the returned subset is added; the button label discloses this ("Add all (shown of total)").
- **Regenerate-then-forget guard**: because contacted status keys off durable timestamps, regenerating an email won't accidentally re-enable emailing someone already sent to. The only way to email again is the drawer's Emailed toggle (`contacted_override=false`).
- **Shared-inbox propagation is address-normalized** (strip `mailto:`, lowercase, trim) on both sides — but it depends on the *same address string* being stored on both authors; near-duplicate/alias addresses won't be detected as the same inbox.
- **Test send bypasses both guards** (`to_override`): it will "send" to already-contacted people and to prospects with no real email. Safe only because it routes to the override address, but do not read a successful test as proof a real send will include those recipients.
- **Manual-add seed score of 50** means manually added authors always surface mid-list in score-sorted views even before real scoring — intentional, but can be misleading if you sort by score.
- **`addWorkflowProspect`/`addWorkflowProspects` re-include but don't re-rank existing rows** — a re-added, previously-excluded prospect keeps its old rank; only brand-new authors get `maxRank+1`.

---

## Emails (Generate & Send)

### Purpose

This area is the outreach composer. Once a workflow has discovered prospects (writers + their articles + contact info), the Emails page lets you turn those prospects into **personalized outreach** on one of two channels:

- **Email** — the AI writes a personalized opener per recipient, merges it into a template, saves each as a draft, then (in a separate step) schedules them to drip out via Gmail SMTP with per-user timezone/window/spacing rules. Replies can optionally be routed to the AI negotiation loop.
- **LinkedIn** — the AI writes short (≤300 char) connection-request notes per recipient. These are **generate-only**: nothing is ever sent. You copy them (one at a time or in bulk) and paste them into LinkedIn manually.

The whole flow is: pick a workflow → pick a channel → optionally pick a template → select which prospects to include → **Generate** → review/edit → (email only) **Send All** with a chosen sender identity.

Source: page at `src/app/emails/page.tsx`.

---

### UI walkthrough

The page (`src/app/emails/page.tsx`) is a full-height two-region layout: a left column with a controls bar, a stats row, and a scrollable prospect table; plus several dialogs/sheets. On mount it fetches three things in parallel (`useEffect`, lines 169-179): `/api/workflows`, `/api/email-templates`, and `/api/inbox-accounts` (the last tolerates non-200 by falling back to `[]`).

#### Channel toggle (Email / LinkedIn)

A segmented control (lines 495-510) with two buttons:
- **Email** (Mail icon) — sets `mode="email"`. Active state is a light background.
- **LinkedIn** (custom brand glyph, since lucide dropped brand icons — `Linkedin` component lines 24-30) — sets `mode="linkedin"`. Active state tints it LinkedIn blue `#0a66c2`.

Switching mode drives nearly everything below it. A `useEffect` (lines 198-200) drops the selected template if it no longer matches the channel (templates are per-channel). Changing `mode` also re-runs the workflow effect (lines 181-195), which re-checks generation status for that channel.

#### Workflow picker

A custom searchable dropdown (lines 512-551). Button shows the selected workflow name or "Select workflow...". Clicking opens a popover with a search box (filters `workflows` by name, case-insensitive) and a scrollable list; each row shows the workflow name and its `prospect_count` (if any). "No workflows match" empty state when the filter excludes everything. Selecting a workflow sets `selectedWorkflow` and closes the popover.

Selecting a workflow triggers the effect at lines 181-195 which:
1. Clears any running generation timer and resets `generating`.
2. Calls `fetchRows(id)` to load the merged prospect/email/linkedin rows.
3. Fetches `/api/workflows/{id}/send-config` into `config`.
4. Fetches `/api/outreach/contacted?exclude_workflow={id}` into `contactedElsewhere` (a `Set` of author IDs already contacted in OTHER campaigns).
5. Fetches `/api/workflows/{id}/generate-status` (with `?channel=linkedin` in LinkedIn mode) — if a run is still `running`, it flips `generating` on and resumes polling (`pollGen`). This is the **resume-after-tab-close** behavior.

`fetchRows` (lines 242-269) fetches prospects (`?limit=500`), emails, and linkedin notes in parallel, builds `Map`s keyed by `author_id`, and produces one `EmailRow` per prospect carrying `{author, articles, contacts, included, email, linkedin}`.

#### Template picker

A `SearchableSelect` (lines 556-564) showing only templates for the current channel (`channelTemplates`, filtered at line 467). `noneLabel` is "No template (AI note only)" for LinkedIn or "No template (AI-only opener)" for email — i.e. you can generate with no template at all. When a template is selected, an **edit (pencil)** button appears next to it (lines 565-569) opening the template editor for that template.

#### "+ Template" button

(lines 573-575) Opens the template editor in create mode via `openTemplateEditor()` with no argument. New templates default to the current channel and get channel-appropriate starter content (lines 393-419): LinkedIn defaults to body `{{custom_line}}`; email defaults to a full subject + multi-line body referencing `{{tool_mentioned}}`, `{{author_name}}`, `{{custom_line}}`, `{{article_link}}`, signed "Abdullah / ImagineArt".

#### Right-side action cluster

- **Progress indicator** (lines 578-583): while `generating`, shows a spinner and `{done}/{total} generated`.
- **Generate ({includedRows.length})** button (lines 585-589): disabled if no workflow selected or already generating. Shows "Generating..." with spinner while active. Calls `generateAll()`.
- **Email mode only** (lines 590-607):
  - **Schedule** button — just routes to `/settings` (schedule is now per-user, configured in Settings; the in-page Schedule sheet still exists in code but is opened via `showSchedule`, which this button no longer sets — see Edge cases).
  - **Send All ({readyCount})** — violet button. Disabled when no workflow, `scheduling` in progress, or `readyCount === 0`. Tooltip: "Generate emails first" when nothing's ready. Clicking resets `chosenSender` to "" and opens the "Send from" dialog (`setChooseSenderOpen(true)`) — it does NOT send directly.
- **LinkedIn mode only** (lines 608-620): **Copy all ({notedCount})** — LinkedIn-blue button. Disabled when `notedCount === 0`. Calls `copyAllNotes()`, which concatenates every generated note (for included, not-contacted-elsewhere prospects) as a labelled list (`Name — url\nbody`, joined by `\n\n———\n\n`) and copies to clipboard.

#### Stats row

Only rendered when `rows.length > 0` (lines 625-658). Shows:
- `{includedRows.length}` **selected**.
- Email mode: `{readyCount}` **ready** (green) and `{count of rows with no email}` **not generated**.
- LinkedIn mode: `{notedCount}` **notes ready** (blue) and `{count of rows with no linkedin}` **not generated**.
- If `genErrors.length > 0`: a red "{n} errors" with an alert icon.
- A **row search box** (right-aligned) filtering the table by name / email / subject (email) or name / note (linkedin) — see `displayRows`, lines 479-487.
- **Select all / Deselect all** toggle (lines 651-656) calling `toggleAllRows(!allIncluded)`.

Counts (lines 465-478):
- `readyCount` — rows that are `included` AND not in `contactedElsewhere` AND have a real `mailto` contact AND whose email `status` is `ready` or `scheduled`. This is deliberately the exact set the send route will schedule (the comment notes the old count wrongly included "sent" and ignored these filters).
- `notedCount` — rows `included`, not contacted elsewhere, with a `linkedin.body`.
- `allIncluded` — every row is `included`.

#### Prospect table

Empty/loading states (lines 662-674): no workflow → channel-appropriate icon + prompt; loading → spinner; workflow with no prospects → "No prospects in this workflow yet — run it from the Workflows page first".

Otherwise a table (lines 676-799) with columns: checkbox, Author, "Their article & subject" (email) / "Their article & connection note" (linkedin), Status, and an actions cell. Each row (`displayRows`):
- Dimmed to 40% opacity if not included OR contacted elsewhere (line 699).
- **Checkbox** (line 702): checked = `included && !contacted`; **disabled** if contacted elsewhere. Toggling calls `toggleInclude(authorId, v===true)` which optimistically updates state then PATCHes `/api/workflows/{id}/prospects/{authorId}` with `{included}`.
- **Author cell**: avatar (initials fallback), full name as a button that opens the author drawer (`openAuthor`). If contacted elsewhere, an amber **"contacted ✕"** badge (lines 717-726) — clicking it calls `uncontact(authorId)` which optimistically removes the author from `contactedElsewhere` and PATCHes `/api/authors/{authorId}/contacted` with `{contacted: false}` (the manual "email them again" override). Below the name: in LinkedIn mode, the LinkedIn profile URL (linkified) or "no LinkedIn on file"; in email mode, the email address colored green (verified) or amber with a **"guess"** badge if `emailIsGuess` (source heuristic via `isGuessSource`), or "no email on file".
- **Article/content cell**: latest article title + date, then the generated subject (email) or note body (linkedin) — or italic "Not generated yet".
- **Status cell**: LinkedIn shows a badge "generated" (blue) or "pending". Email shows a `StatusBadge` with the email's status (`draft`/`ready`/`scheduled`/`sent`/`failed`, color-mapped at lines 38-44) or "pending" if no email.
- **Actions cell**: LinkedIn (if a note exists) shows a **Copy** button (copies that one note) and an **Edit** button. Email (if a body exists) shows an **Edit** button. Edit opens the editor via `openEmailEditor(row)`.

#### Template Editor dialog

(lines 805-885) Title switches on `templateForm.channel` and create/edit mode. Fields:
- **Template name** (required).
- **Subject line** — email templates only (hidden for LinkedIn).
- **Body / Connection note** — required. For LinkedIn, shows a live char counter `{len}/300` that turns red over the limit, plus helper text about staying under 300 and leaving `{{custom_line}}` to send the AI note verbatim.
- **Writing direction for {{custom_line}}** (`guidance`, optional) — free text steering the AI's tone/angle; applied per-recipient on top of article context. Different placeholder examples for LinkedIn vs email.
- **Available placeholders** panel — lists `PLACEHOLDER_DOCS` (email: `author_name`, `pub_name`, `article_title`, `article_date`, `tool_mentioned`, `custom_line`, `article_link`) or `LINKEDIN_PLACEHOLDER_DOCS` (`author_name`, `first_name`, `pub_name`, `custom_line`).
- Email templates show an **amber spam warning** about links in cold emails and the default `{{article_link}}` line.

Save button disabled unless name + body present (and subject present for email). `saveTemplate` (lines 367-391): PATCHes `/api/email-templates/{id}` when editing (optimistic local merge), or POSTs `/api/email-templates` when creating (prepends the returned template and auto-selects it).

#### Email/Note Editor sheet

(lines 888-951) Right-side sheet. Header shows the author name + their email (email mode) or LinkedIn URL (linkedin mode). Body shows an "article context" card (title, date, `view` link, excerpt) so edits stay grounded. Email mode: Subject input + Body textarea (min-h 320). LinkedIn mode: no subject, a note textarea (min-h 160) with a `{len}/300` counter and an inline **Copy** button.

`saveEmail` (lines 433-463):
- LinkedIn: PATCHes `/api/workflows/{id}/linkedin` with `{author_id, body}`, updates local row, toasts "Note saved."
- Email: PATCHes `/api/emails/{emailId}` with `{subject, body, status:"ready"}` — **editing forces status back to `ready`** — updates local row, toasts "Email saved."
- Save button in LinkedIn mode is disabled if the note exceeds 300 chars.

#### Schedule settings sheet

(lines 954-1024) Opened via `showSchedule`. Contains timezone select (`TIMEZONES` list), send-from/until hours, gap minutes, daily cap, from-name, from-email (blank = server default), and a live summary line. `saveConfig` (lines 202-213) PATCHes `/api/workflows/{id}/send-config`. Note: the visible "Schedule" button now navigates to `/settings` instead of opening this sheet, so this sheet is effectively dormant in the current UI (see Edge cases).

#### "Add app password" dialog (needsAppPassword)

(lines 1027-1057) Shown when `needAppPw` is set — i.e. Send All was blocked because the chosen sending identity has no Gmail app password. Two variants:
- **Your own** ("your"): step-by-step setup (enable 2-Step Verification → create an app password for "Mail" → paste into Settings → Your sending email). Has a "Go to Settings" button.
- **Someone else's** (a shared inbox): tells you that person must sign in and add their own app password before anyone can send through their inbox. No settings shortcut (you can't fix it for them).

#### "Send from" dialog

(lines 1060-1103) Opened by clicking **Send All**. Contains:
- **Sender select** (lines 1066-1075): first option is "Your own email ({myEmail})" (value `""`). Then, for admins only, every OTHER team inbox from `inboxAccounts` (each `{label} — {email}`), filtered to exclude your own address. Helper text explains that choosing a teammate "Sends from {email}'s Gmail, attributed to them (as if they pressed Send)."
- **Send to (test override)** (lines 1081-1085): amber-bordered input labeled "admin / testing". If set, every email routes here instead of the prospects, from the chosen inbox, and the contacted/duplicate guards are bypassed; AI replies also land on this address so you can test the full loop. Bound to `toOverride`.
- **Let AI handle replies** toggle (lines 1088-1094): `aiReplies` (default `true`). When on, replies route to the Negotiation page and the AI negotiates using the Handbook (pricing tiers, lowball strategy). Autonomy level is set in the Handbook.
- **Send All ({readyCount})** button → `scheduleSend(chosenSender)`.

`scheduleSend(senderEmail)` (lines 216-240): POSTs `/api/workflows/{id}/send` with `{ sender_email? (only if non-empty), ai_managed: aiReplies, to_override? (only if non-empty) }`. Response handling:
- `data.needsAppPassword` → look up the inbox account label and open the needsAppPassword dialog.
- `res.ok && data.scheduled > 0` → success toast `Scheduled {n} emails from {sender}{via}{skipped}`, then `router.push("/sending")`. `via` appends "(sent by X)" when `sentBy !== sender`; `skipped` appends "(N skipped — already contacted elsewhere)".
- `res.ok` but scheduled 0 → error toast with `data.reason` or "Nothing to schedule — generate emails first."
- otherwise → error toast with `data.error` or "Failed to schedule."

#### Generate flow (`generateAll`, lines 325-347)

Guards: no workflow → return; `includedCount === 0` → error toast "No prospects selected". Sets `generating`, resets progress to `{done:0, total:includedCount}` and errors. POSTs `/api/workflows/{id}/{generate-emails|generate-linkedin}` with `{template_id: selectedTemplate?.id}`. If `!res.ok || data.started === false`: if `alreadyRunning` → info toast "Generation already running — showing progress"; else error toast (`data.reason`) and stop. Then `pollGen(id, mode)`.

`pollGen` (lines 305-323): polls `/api/workflows/{id}/generate-status` (`?channel=linkedin` for LinkedIn) every 2500ms. Each tick updates `genProgress` and `genErrors`, **refetches rows** so completed items appear live, and when `!running` clears the timer, flips `generating` off, and toasts "Generated {done} {noun}{, N errors}".

---

### API routes / server logic

#### POST `/api/workflows/[id]/generate-emails`

File: `src/app/api/workflows/[id]/generate-emails/route.ts`. `maxDuration = 300`.

- **Body**: `{ template_id?: string }` (tolerant of empty/invalid JSON).
- **Auth**: none enforced at the route (relies on the app-level sign-in gate).
- **Logic**:
  1. `getWorkflow(id)` → 404 `{error:"Workflow not found"}` if missing.
  2. If `isGenRunning(id)` → returns `{started:false, alreadyRunning:true}` (no new run).
  3. Loads prospects (`limit:500`) and `getContactedAuthorIds(id)`; `total` = count of prospects that are `included` AND not contacted elsewhere. If `total === 0` → `{started:false, total:0, reason:"No new prospects to generate (already contacted or none selected)."}`.
  4. `startGen(id, total)` (marks running in Redis BEFORE responding so the poll on any instance sees it), then schedules `runGeneration(id, template_id)` via `after()` (Next.js post-response work; a bare fire-and-forget promise would be frozen after the response). Errors in the detached run call `finishGen(id)`.
  5. Returns `{started:true, total}`.
- **`runGeneration`** (lines 132-183): loads template (if any), prospects, contacted-elsewhere set; filters to `included && !contactedElsewhere`. Processes in batches of **5** (`CONCURRENCY`). Per prospect: derives `pubName` (via `cleanPubName`, free-mail hosts become "your work"), collects up to 5 distinct tool names from article mentions, calls `generateOpener(...)`, builds the `vars` map (including a real `article_link` = the lead article's `url_canonical`), fills the template (`fillTemplate` + `dropLineIfEmpty` for `article_link` so an unfillable link line is removed whole), sanitizes, then `upsertOutreachEmail({...status:"ready"})` and `bumpGen(id)`. On error: `bumpGen(id, "{name}: {message}")`. Finally `finishGen(id)`.
- **`generateOpener`** (lines 68-116): builds a safe fallback opener (uses a cleaned lead title if present). If no `OPENROUTER_API_KEY` or no real article content → returns the fallback (never fabricates). Otherwise calls OpenRouter `anthropic/claude-haiku-4-5` (max_tokens 200, temp 0.7, 20s timeout) with hard rules (no bracketed placeholders, no "Re:", no em/en-dashes, short 1-2 sentences, no greeting/sign-off, plus the template's `guidance`). Non-200 throws. Output is `sanitize`d; if empty or still contains a placeholder (`hasPlaceholder`), the fallback is used.
- Helper cleaners: `sanitize` (removes em/en dashes → commas, collapses spaces, caps blank lines, preserves paragraph structure), `cleanTitle` (decodes HTML entities, strips " | Site" / " - Site" suffixes, trims dangling conjunctions, caps at 90 chars), `decodeEntities`.

#### POST `/api/workflows/[id]/generate-linkedin`

File: `src/app/api/workflows/[id]/generate-linkedin/route.ts`. `maxDuration = 300`. Structurally identical to generate-emails but keyed `"{id}:linkedin"` so the two channels' progress never collide.

- Same body `{template_id?}`, same 404 / `alreadyRunning` / `total===0` branches, same `startGen`/`after`/`finishGen` pattern, same batch size 5.
- **`generateNote`** (lines 37-79): builds a fallback note (starts "Hi {firstName},", references lead title if known). If no key or no article content → fallback. Otherwise OpenRouter `claude-haiku-4-5` (max_tokens 160) with rules: under **280 chars** (`MAX_CHARS`, a safety margin below LinkedIn's 300 hard cap), start "Hi {first},", reference their work briefly, no placeholders/em-dashes/hashtags/emojis/links, light reason to connect. Output empty or placeholder → fallback; else `clampNote` (strips AI tells, collapses newlines to spaces, and truncates at word boundary to ≤280 chars).
- If a LinkedIn template is chosen, its body wraps the note via `{{custom_line}}` (with `author_name`/`first_name`/`pub_name`), else the note itself is the body. Persists via `upsertLinkedinMessage`.
- Returns `{started:true, total}` (or the same error branches as generate-emails).

#### GET `/api/workflows/[id]/generate-status`

File: `src/app/api/workflows/[id]/generate-status/route.ts`.

- **Query**: `?channel=linkedin` polls the LinkedIn key `"{id}:linkedin"`; otherwise the email key `id`.
- Calls `getGen(key)`. If null → `{running:false, done:0, total:0, errors:[]}`. Else `{running, done, total, errors}`.

#### GET `/api/workflows/[id]/emails`

File: `src/app/api/workflows/[id]/emails/route.ts`. Returns `getWorkflowEmails(id)` — an array of outreach emails. On error → 500 `{error}`.

`getWorkflowEmails` (queries.ts lines 1456-1468) filters to **initial** outreach only (`kind.eq.initial` OR `kind.is.null`), joined with author/domain, ordered by `created_at` asc. The comment warns that without this filter a newer negotiation/follow-up draft would shadow the initial per author and show "0 ready".

#### GET / PATCH `/api/workflows/[id]/linkedin`

File: `src/app/api/workflows/[id]/linkedin/route.ts`.
- **GET**: `getLinkedinMessages(id)` — all generated notes for the workflow. 500 on error.
- **PATCH**: body `{author_id, body}`; requires `author_id` and a string `body` else 400 `{error:"author_id and body required"}`. Upserts on `workflow_id+author_id` via `upsertLinkedinMessage`. Returns `{ok:true}`.

#### POST `/api/workflows/[id]/send`

File: `src/app/api/workflows/[id]/send/route.ts`. `maxDuration = 300`. This is the heart of sending. Everything runs inside a try/catch → 500 `{error: e.message}` on any throw.

- **Auth** (lines 19-21): `auth()`. If no `session.user.email` → **401** `{error:"not signed in"}`.
- **Body**: `{ sender_email?, ai_managed?, to_override? }`.
- **Sender resolution / admin act-as** (lines 27-41):
  - Default: `senderEmail = sentByEmail = authEmail` (send from your own Gmail, attributed to you).
  - If `sender_email` is a non-empty string that differs (case-insensitive) from `authEmail`:
    - If **not admin** (`!isAdminEmail(authEmail)`) → **403** `{error:"Only an admin can send as another user."}`.
    - Look up the account in `getInboxAccounts()`. If not found (no connected Gmail app password) → **400** `{error:"That account can't be sent from — it has no connected Gmail app password."}`.
    - Otherwise full act-as: `senderEmail = sentByEmail = acct.email`, `actingAs = true`. The email is sent from their Gmail AND attributed to them, exactly as if they'd pressed Send.
- **App password check** (lines 43-52): `getUserEmailConfig(senderEmail)`. If `!hasPassword` → returns (200) `{ needsAppPassword:true, sender, reason }` where `reason` differs for act-as vs own. This is NOT an HTTP error — the client detects `needsAppPassword` in the body.
- **Config shaping** (lines 55-59): builds an `EmailSendConfig` from the *sender's own* user config (timezone/window/gap/cap/from_name), with `from_email = senderEmail`. The chosen sender's own sending rules protect their Gmail account.
- **Candidate selection** (lines 61-85):
  - Loads `getWorkflowEmails(id)` and prospects (`limit:1000`) in parallel.
  - `includedIds` = author IDs of included prospects; `prospectByAuthor` map for contact lookup.
  - `toOverride` = trimmed `body.to_override`; `testMode = !!toOverride`.
  - `contactedElsewhere = getContactedAuthorIds(id)`.
  - `sendable` filter per email: must be in `includedIds`; status must be `ready` or `scheduled`; if NOT test mode and author is in `contactedElsewhere` → skip and increment `skippedContacted`; in test mode → always include (override supplies the address, no real mailto needed); otherwise require the author to have a `mailto` contact.
- **Nothing-to-schedule branch** (lines 87-95): if `sendable.length === 0` → returns `{scheduled:0, skippedContacted, reason}` where reason is either "All candidates were already contacted in another campaign (N skipped)." (if `skippedContacted>0`) or "No ready emails with a recipient address — generate first."
- **Scheduling** (lines 97-112): builds `ScheduleRecipient[]` (every recipient uses the sender's own timezone), computes slots with `computeSmartSchedule`, then `scheduleWorkflowEmails(id, ids, times, senderEmail, sentByEmail, ai_managed===true, toOverride||undefined)`. Returns `{ scheduled, skippedContacted, sender, sentBy, firstAt, lastAt, timezone, config:{timezone, gap_minutes, daily_cap, window} }`.

`scheduleWorkflowEmails` (queries.ts lines 2176-2194) per email sets `scheduled_at`, `status:"scheduled"`, `error:null`, and conditionally `sender_email`, `sent_by_email`, `ai_managed:true`, and `recipient_override` (the test target). It does NOT send — a separate cron/worker processes the queue at send time.

#### GET / POST / PATCH / DELETE — templates

- **GET `/api/email-templates`** (`src/app/api/email-templates/route.ts`): all templates newest-first (`getEmailTemplates`). 500 on error.
- **POST `/api/email-templates`**: body `{name, subject, body, guidance, channel}`. Requires `name` and `body`, and `subject` only when `channel !== "linkedin"`; else 400 `{error:"name, subject, body required"}`. Creates via `createEmailTemplate` (subject defaults to `""`), returns the row with **201**.
- **PATCH `/api/email-templates/[id]`** (`.../[id]/route.ts`): passes the whole body to `updateEmailTemplate(id, body)` (bumps `updated_at`). Returns `{ok:true}`. 500 on error. Note: no field whitelist here.
- **DELETE `/api/email-templates/[id]`**: `deleteEmailTemplate(id)` → `{ok:true}`. 500 on error. (No UI on this page calls DELETE.)

#### POST / GET `/api/emails/test`

File: `src/app/api/emails/test/route.ts`. A standalone SMTP-health tool (not wired into this page's buttons but part of the email area).
- **POST** body `{to}`: 400 `{error:"recipient 'to' required"}` if missing. Sends a fixed test message via `sendEmail` using the **env SMTP sender** (`SMTP_FROM_EMAIL`/`SMTP_USER`), not per-user identity. Returns the `SendResult` with status 200 (ok) or 500 (failure).
- **GET**: `verifyTransport()` — checks the SMTP connection without sending. 200/500 by `result.ok`.

#### Supporting routes used by this page

- **PATCH `/api/emails/[id]`** (`src/app/api/emails/[id]/route.ts`): the editor's save target. Passes body straight to `updateOutreachEmail(id, body)` (no whitelist). GET returns one email or 404.
- **GET/PATCH `/api/authors/[id]/contacted`** (`.../contacted/route.ts`): PATCH body `{contacted: boolean|null}` → `setContactedOverride` (`true` = never email again, `false` = email again, `null` = revert to derived). The "contacted ✕" badge sends `false`. GET returns `{contacted, override, hasHistory}`.
- **GET `/api/outreach/contacted?exclude_workflow={id}`** (`.../outreach/contacted/route.ts`): `{authorIds: [...]}` — authors contacted/queued in OTHER campaigns (the current workflow is excluded).
- **GET `/api/inbox-accounts`** (`src/app/api/inbox-accounts/route.ts`): **admin-gated**. 401 `[]` if not signed in; `[]` for non-admins; else every team mailbox with a connected app password (`getInboxAccounts`). This is what populates the act-as picker — non-admins get an empty list, so their picker collapses to just "Your own email".
- **GET/PATCH `/api/workflows/[id]/send-config`** (`.../send-config/route.ts`): GET returns stored config or a non-persisted default. PATCH whitelists `timezone, send_hour_start, send_hour_end, gap_minutes, daily_cap, from_name, from_email, provider` and upserts.

---

### Key checks & validations

- **Admin act-as gating** (`src/lib/auth/admin.ts`): `ADMIN_EMAILS` env (comma-separated, lowercased), defaulting to `abdullah.zubair@imagine.art` when unset. `isAdminEmail` gates (a) which inbox accounts the client even sees (`/api/inbox-accounts`) and (b) whether the send route accepts a foreign `sender_email` (403 otherwise). Two independent enforcement points — hiding the picker AND rejecting server-side.
- **App-password requirement**: the *chosen* sending identity must have `app_password_enc` set (`getUserEmailConfig(...).hasPassword`), else `needsAppPassword`.
- **Sender must be a real connected inbox**: act-as `sender_email` must appear in `getInboxAccounts()` (which only lists accounts with a password), else 400.
- **Contacted-elsewhere guard**: emails to authors already `sent`/`scheduled`/replied/bounced in other campaigns are skipped (except in test mode). Includes **shared-inbox propagation** — if any address of an author was emailed via a *different* author, both count as contacted (`getContactedAuthorIds`, queries.ts lines 1905-1925). Manual `contacted_override` wins over derived history.
- **Recipient-address requirement**: non-test sends require a `mailto` contact; test mode bypasses this (the override supplies the address).
- **Placeholder guard**: generated openers/notes are rejected (fallback used) if they contain `[...]` or `{{...}}`. Template merge also strips any leftover `{{token}}` and drops link lines that can't be filled.
- **Char limits**: LinkedIn notes clamped server-side to 280 chars; the template editor and note editor enforce a 300-char UI cap (save disabled over 300 in the note editor).
- **Template create validation**: name + body always required; subject required only for email channel.
- **Ready-count parity**: the UI's `readyCount` is computed with the same filters the send route applies, so "Send All (N)" matches what actually schedules.
- **Idempotent generation**: `isGenRunning` prevents concurrent runs per channel; `upsertOutreachEmail`/`upsertLinkedinMessage` overwrite the single initial per (workflow, author).

---

### Flows

**Generate emails (or LinkedIn notes):**
1. User picks workflow + channel, optionally a template, and selects prospects (checkboxes / Select all).
2. Clicks **Generate ({n})**. Client validates ≥1 included, POSTs to `generate-emails`/`generate-linkedin` with `template_id`.
3. Route validates workflow exists, no run in flight, and ≥1 eligible prospect; calls `startGen`, responds `{started:true}`, and runs the batched (concurrency 5) generation detached via `after()`.
4. Each prospect: AI opener/note (OpenRouter Haiku, with fallbacks) → template merge → sanitize → upsert as `ready` (email) / note (linkedin); progress bumped in Redis.
5. Client polls `generate-status` every 2.5s, refetching rows so items appear as they finish; stops and toasts when `running` becomes false.
6. If the tab was closed mid-run, reopening the workflow detects `running:true` and resumes the poll.

**Send emails (Send All):**
1. User (email mode) clicks **Send All ({readyCount})** → "Send from" dialog opens.
2. User picks identity (own, or — admins only — a teammate's inbox), optionally sets a **test override** address, and toggles **Let AI handle replies**.
3. Clicks Send → POST `/api/workflows/{id}/send`.
4. Route authenticates, resolves sender (admin check for act-as), verifies the sender has an app password, filters to sendable emails (included + ready/scheduled + recipient present + not contacted elsewhere, unless test mode), computes drip slots in the sender's timezone/window, and marks each email `scheduled` with `scheduled_at`, `sender_email`, `sent_by_email`, and optionally `ai_managed` / `recipient_override`.
5. Client toasts the scheduled count (and any skipped/act-as note) and navigates to `/sending`. Actual delivery happens later via the sending worker/cron.

**Edit a draft:** click Edit → sheet with article context → change subject/body (email) or note (linkedin) → Save → PATCH `/api/emails/{id}` (forces status `ready`) or `/api/workflows/{id}/linkedin`.

**Re-allow a contacted person:** click the amber "contacted ✕" badge → PATCH `/api/authors/{id}/contacted` `{contacted:false}` → row un-dims, checkbox re-enabled, and future sends/generation include them.

**LinkedIn distribution:** generate notes → **Copy all** (or per-row Copy) → paste manually into LinkedIn. Nothing is ever sent by the app.

---

### Edge cases & cautions

- **Send route has no HTTP error for `needsAppPassword`** — it returns HTTP 200 with `{needsAppPassword:true}`. Clients that only check `res.ok` would treat this as success; the page correctly inspects the body first.
- **Test override is a powerful bypass**: `to_override` reroutes **every** email in the send to one address AND disables both the contacted-elsewhere guard and the has-real-email guard. It's gated only by being in the "Send from" dialog (any signed-in user can set it — it is not itself admin-gated, though act-as to another inbox is). The override is persisted per-email as `recipient_override`, so the queued sends carry the test target. Clear it before a real send.
- **Act-as is admin-only in two places** but the *own-email* path is always allowed. A non-admin passing a foreign `sender_email` gets a 403; a non-admin never even sees other inboxes because `/api/inbox-accounts` returns `[]` for them.
- **Sending as a teammate requires THEIR password**: you cannot fix another person's missing app password from your session — the needsAppPassword dialog for a shared inbox has no "Go to Settings" shortcut, and they must sign in themselves.
- **The visible "Schedule" button routes to `/settings`, not the in-page Schedule sheet.** The Schedule sheet (`showSchedule`) and `saveConfig` (which PATCHes the workflow-level `send-config`) remain in the code but nothing sets `showSchedule` to `true` anymore, so per-workflow send-config editing is effectively unreachable from this page. The actual schedule used at send time comes from the sender's **per-user** config (`getUserEmailConfig`), not the workflow `send-config`. This is a latent inconsistency: `getSendConfigOrDefault`/`upsertSendConfig` still exist and the sheet's fields (from_name/from_email/timezone) would write to a table the send route ignores.
- **Generation is fire-and-forget on the server.** Progress lives only in Redis (`genBuffer.ts`) with a 1h TTL; without Redis it falls back to an in-memory `Map` that is **invisible across serverless instances** — the POST and the status GET can land on different instances and the poll would show 0/0. Redis is required for reliable progress in production.
- **Per-item generation errors are silent-ish**: a failed opener/note doesn't abort the run — it just increments `done` with an error string. The UI surfaces only a count ("N errors"); the individual messages are in `genErrors` but not shown per-row.
- **Regenerating overwrites edits**: `upsertOutreachEmail`/`upsertLinkedinMessage` replace the single initial per author, so re-running Generate discards any hand-edits (and resets status to `ready`). Generation also skips authors contacted elsewhere entirely, so those never get a draft.
- **`readyCount` includes `scheduled` emails**, so Send All can re-schedule already-queued emails (recomputing their slots). This is intentional for re-sends but means clicking Send All twice reshuffles the queue.
- **`PATCH /api/emails/[id]` and `PATCH /api/email-templates/[id]` pass the raw body to the DB** with no field whitelist (unlike send-config's PATCH). A malformed body could set unintended columns; callers are trusted here.
- **AI-reply autonomy is chosen at send time** (`ai_managed`), not per template. Turning it on only marks the thread; how aggressively the AI negotiates is governed by the Handbook, and it can be enabled later per thread if left off.
- **Free-mail publications**: `cleanPubName` maps gmail/outlook/etc. to "your work" so openers don't say "your readers at gmail.com" — but only in the email generator; the LinkedIn generator uses the raw `pub_name`.
- **No article content ⇒ generic opener**: if OpenRouter is unconfigured or the prospect has no usable article title/excerpt, the AI step is skipped and a safe fallback is used — so "personalized" emails can be quite generic for thin prospects.

---

## Sending (Scheduled & Sent)

### Purpose

The Sending area is the operational dashboard for outreach mail after it has been composed and scheduled. It is where a user watches emails drip out automatically at each recipient's local time, sends any queued email early, reschedules or cancels queued sends, reads sent copy and inbound replies, arms/disarms automatic threaded follow-ups, marks conversations that converted into press coverage as "wins", and tracks all-time ROI (reply rate, win rate, reply→win conversion).

The core promise, stated in the page header (`src/app/sending/page.tsx:526-528`): *"Emails drip out automatically at each recipient's local time. Replies are detected automatically; no-reply emails get a threaded follow-up scheduled after 2 days."*

The main page is `src/app/sending/page.tsx` (a `"use client"` component). It reads from `GET /api/emails/status` and drives every action through the `/api/emails/*` routes. Sending itself is done by the batch processor (`POST /api/emails/process`) and the single-email `POST /api/emails/[id]/send-now`, both of which share the same delivery pipeline (`src/lib/email/deliver.ts` → `src/lib/email/smtp.ts`) and the same send-time safety guards.

---

### UI walkthrough (`src/app/sending/page.tsx`)

#### Live data model & polling

- On mount the page fetches `GET /api/emails/status?...` and then **re-polls it every 5 seconds** (`src/app/sending/page.tsx:167-171`, interval in `load`). Any action the user takes also calls `load()` immediately afterward, so the UI reflects DB state within a poll.
- A separate 1-second interval keeps a live wall clock and derives the local timezone abbreviation (`tzAbbr`) via `Intl.DateTimeFormat` (`page.tsx:113-118`).
- The status payload is typed as `Status` (`page.tsx:53-61`): `counts`, `roi`, and five paginated lists each with a companion `*Total`: `upcoming`/`upcomingTotal`, `recent`/`recentTotal`, `followups`/`followupsTotal`, `replied`/`repliedTotal`, `wins`/`winsTotal`.

#### Header row

Left side: the page title ("Sending", Send icon) and the drip explainer text.

Right side controls (`page.tsx:530-557`):

1. **Live local clock** — shows `HH:MM:SS` + `tzAbbr`, tooltip "Your current local time". Only rendered once `now` is set (client-only, avoids hydration mismatch).
2. **Auto follow-ups switch** — a global kill switch for automatic follow-ups. Its initial value is fetched once from `GET /api/emails/followups` (`page.tsx:133`); while unknown the switch is `disabled` (`followupsOn === null`). Toggling calls `toggleFollowups(on)` → `PATCH /api/emails/followups { enabled }` and shows a toast: ON = "no-reply emails get a threaded nudge scheduled after 2 days", OFF = "no new follow-ups will be scheduled" (`page.tsx:134-138`). The switch is set optimistically before the request.
3. **Timezone select + Apply** — a `<select>` of a fixed `TIMEZONES` list (13 zones incl. UTC, `page.tsx:15-19`) plus an **Apply** button. Apply is disabled unless a tz is chosen **and** `scheduled > 0` (there is something queued). `applyTimezone()` → `POST /api/emails/reschedule { timezone }`; the toast reports how many were rescheduled (`page.tsx:260-271`). The default selected value is seeded from the first queued/recent email's tz (`page.tsx:162`).
4. **Refresh** — manual `load()`; the icon spins while `loading`.
5. **Process now** — `processNow()` → `POST /api/emails/process`. Tooltip: "Send due emails + check replies + schedule any due follow-ups now". The success toast summarizes `{sent} sent of {due} due` plus any new replies / follow-ups scheduled, or "A send run is already in progress." when the processor reports `skipped` (`page.tsx:173-185`).

#### ROI stat tiles (`page.tsx:561-569`)

Seven `Stat` tiles, all **all-time**, driven by `status.counts` and `status.roi`:

| Tile | Source | Meaning |
|---|---|---|
| In pipeline | `counts.scheduled` | Initial emails scheduled, not yet sent |
| Emails sent | `counts.sent` | Initial outreach sent (all time) |
| Replies | `counts.replied` | Auto-detected genuine human replies |
| Reply rate | `roi.replyRate`% | replies ÷ sent |
| Wins | `counts.success` | Coverage secured |
| Win rate | `roi.winRate`% | wins ÷ sent |
| Reply→Win | `roi.replyToWin`% | wins ÷ replies |

#### Tabs (`page.tsx:510-516`, `571-671`)

Five tabs, each showing its total count in parentheses:

- **Queued** (`upcomingTotal`) — scheduled initials not yet sent.
- **Sent & failed** (`recentTotal`) — the chronological record of everything that actually went out (initials AND sent/failed follow-ups).
- **Replied** (`repliedTotal`) — threads with a genuine human reply.
- **Follow-ups** (`followupsTotal`) — all follow-up rows of any status.
- **Wins** (`winsTotal`) — sends marked as coverage.

A right-aligned note reads "grouped by sender, then date". Each tab has a colored info banner explaining its rules, then a scrollable (`max-h-[560px]`) grouped list.

**Queued banner:** "All N are scheduled across multiple days (capped per sender per day) — nothing is dropped; overflow automatically rolls to the next day."
**Sent & failed** has an in-tab filter chip row: `all / replied / bounced / wins / followed up` (`sentFilter` state, filtered client-side, `page.tsx:495-500`, `608-613`) plus the note "Pending follow-ups live in the Follow-ups tab."
**Replied banner:** genuine human replies only; bounces and auto-replies are excluded (they appear under Sent & failed).
**Follow-ups banner:** one follow-up per recipient, sent as a reply in the original thread, each with a date and its own on/off switch; the header toggle pauses all new follow-ups.
**Wins banner:** click the 🏆 to edit the coverage link/notes.

#### The two-level grouped list (`GroupedList`, `page.tsx:291-369`)

Every tab renders through `GroupedList`, which groups items **by sender** ("who it was/will be sent from") and then **by day** within each sender:

- Sender key = `sender_email` or `"__default__"`; sender label = `sender_label` (shared-inbox label) ‖ `sender_email` ‖ "Default account" (`page.tsx:85-86`).
- Senders are sorted by descending email count, then label. Each sender is a **collapsible section** with a sticky header showing a chevron, a Users icon, the label, and a count badge. Clicking toggles `collapsedSenders` (keyed `"<tab>:<senderKey>"`, `page.tsx:107-111`).
- Within an expanded sender, rows are sliced to `perPersonShown[key] ?? PER_PERSON` (**8**), grouped into day headers via `dayLabel()` (e.g. "Mon, Jul 20"), with a per-day count. A **"Load more from <label> (N more)"** button bumps that sender's slice by 8 (client-side only — no new fetch).
- At the very bottom, when `fetchedCount < total`, a **"Load older from server (N more)"** button grows the server fetch window. Increments: Queued +200, Sent +80, others +200 (`page.tsx:600,620,636,651,667`).
- Empty state: each tab passes its own `emptyText` (e.g. "No emails scheduled", "No replies yet", "No follow-ups yet — they're scheduled automatically 2 days after an unanswered send.").

Initial server fetch windows (state defaults, `page.tsx:100-104`): upcoming 200, recent 80, followups 200, replied 200, wins 200. These are sent as `*_limit` query params to the status route (which caps each at 500).

#### Queued row (`queuedRow`, `page.tsx:372-413`)

- Author name (clickable → opens the author drawer via `openAuthor(e.author_id)`), with an amber **"guess"** badge when `e.guess` is true (email was pattern-constructed, not sourced).
- Recipient email in mono blue, or a red italic **"no email address"** when missing.
- Subject (falls back to publication).
- Right: `local_label` (recipient-local send time, blue) + the short tz name.
- Action buttons:
  - **Send** (green) — `sendNow(e)` → `POST /api/emails/[id]/send-now`. Spinner while sending; toast "Sent to <name>." or the error.
  - **Reschedule** (calendar icon) — toggles an inline `datetime-local` editor pre-filled with the current time in the **user's local zone** (`toLocalInput`). "Save time" calls `reschedule(id, new Date(val).toISOString(), …)` → `PATCH /api/emails/[id] { scheduled_at, status:"scheduled" }`. Note under the input: "Time is in your local zone (<tzAbbr>)."
  - **Edit** (pencil) — opens the edit sheet (loads full body via `GET /api/emails/[id]`).
  - **Cancel** (ban icon, red on hover) — `cancelScheduled(e)` → `PATCH /api/emails/[id] { status:"ready", scheduled_at:null }`. Toast: "Unscheduled — <name> won't be sent until you re-schedule." (See caution: this removes the row from Queued and it does not reappear anywhere on this page.)

#### Sent row (`sentRow`, `page.tsx:415-452`) — used by Sent & failed, Replied, and Wins tabs

- Leading status icon: Trophy (win) / green check (sent) / red X (failed).
- Author name (→ drawer) with inline badges: a follow-up caret + "follow-up" badge (`kind==="followup"`), "replied", "bounced", "auto-reply" (`reply_kind==="auto"` and neither replied nor bounced), "win".
- Secondary line: the error (failed), the bounce subject (bounced), or subject/publication.
- If `success_link`, a clickable "coverage: <domain>" link (opens new tab).
- If `sent_at`, a "sent <date>" line; when a shared inbox actually sent it, appends "by <sent_by_email>" (only when `sent_by_email !== sender_email`).
- Buttons:
  - **Reply / Bounce / Auto** (only if `reply_kind`) — opens the Read sheet, which surfaces the inbound message. Color-coded (red bounce / violet reply / muted auto).
  - **Win / 🏆** (only when `status==="sent" && !bounced_at`) — opens the win dialog; if already a win, the trophy button re-opens it to edit/remove.
  - **Read** — opens the Read sheet with the sent copy.

#### Follow-up row (`followupRow`, `page.tsx:454-492`) — Follow-ups tab

- Icon by state: sent (green caret) / failed (red X) / armed = `status==="scheduled"` (blue clock) / else (ban icon = paused).
- Author name (→ drawer) + "replied" badge if the parent got a reply.
- Status line: "sent <date>" / the error / "sends <local_label>" (armed) / "paused — won't send".
- Controls (only while **unsent**, i.e. status not sent/failed):
  - A **Switch** (`toggleFollowupArmed`) → `POST /api/emails/[id]/followup-toggle { armed }`. Spinner while toggling. Toast: re-armed "it will send" / turned off "it won't send".
  - **Send** (green, only when armed) — `sendNow(e)`.
  - **Edit** (pencil) — edit sheet.
  - **Read** — always shown.
- Sort (`fuSort`, `page.tsx:502-508`): unsent (armed/paused) first, ordered by scheduled time ascending; then sent, most recent first.

#### Edit sheet (`page.tsx:675-694`)

A right side sheet titled "Edit follow-up" or "Edit queued email". On open (`openEditor`) it shows the subject immediately and lazy-loads the full body via `GET /api/emails/[id]` (spinner meanwhile). Subject input + a mono Textarea for the body. **Save** → `PATCH /api/emails/[id] { subject, body }` then `load()`; toast "Email updated." Subheader shows author + scheduled local time (or "not scheduled").

#### Read sheet (`page.tsx:696-723`)

Read-only view of a sent/follow-up email. If the row has a `reply_kind`, a colored panel shows the inbound message first: header ("Bounce notice…" / "Automatic reply (not counted as a reply)" / "Their reply"), `reply_from`, `reply_subject`, and `reply_excerpt`. Below that, "Your sent email" with subject + body (body lazy-loaded via `GET /api/emails/[id]` in `openReader`, `page.tsx:152-156`).

#### Win dialog (`page.tsx:726-740`)

Titled "Mark as a win". Coverage link input + optional notes textarea. **Save win** → `PATCH /api/emails/[id] { success_at:now, success_link, success_notes }`, toast "Logged as a win 🏆". If the email is already a win, a red **Remove win** button clears all three fields (`clearSuccess`, sets them to null). Trimmed empties become `null`.

The author drawer (`useAuthorDrawer`) is mounted at the end and opened by any author-name click.

---

### API routes / server logic

#### Route protection model

There is **no per-route auth check** on most of these endpoints — instead the app-wide `src/proxy.ts` (Next.js 16's proxy, the old middleware) redirects any request without a valid session to `/login`, except `/api/auth/*`, `/api/health`, `/login`, and requests bearing the `CRON_SECRET` (Bearer or `?key=`). So reaching any `/api/emails/*` route requires a logged-in session (or the cron secret for the processor). The nuance for maintainers: routes do **not** re-verify the session and do **not** scope actions to the acting user — any signed-in user can read, edit, send, reschedule, or delete-schedule **any** email. Only `POST /api/emails/process` and `GET|PATCH /api/emails/followups` re-check `auth()` in the handler itself.

#### `GET /api/emails/status` (`src/app/api/emails/status/route.ts`)

- **Query params:** `workflow_id` (optional scope), `recent_offset`/`upcoming_offset` (default 0), and five window sizes `recent_limit` (default 40), `upcoming_limit` (default 60), `followup_limit`/`replied_limit`/`wins_limit` (default 200). **Every limit is capped at 500** (`Math.min(500, …)`).
- **Logic:** runs `getSendingStatus(...)` and `getSharedSenders()` in parallel, builds a `sharedLabelByEmail` map, then `enrich()`es each row (`route.ts:28-63`):
  - `tz` = `author.timezone` ‖ `inferTimezone(host, country, "America/New_York")`.
  - `local_label` = `localTimeLabel(scheduled_at ?? sent_at, tz)` or null.
  - `recipient` = the author's `mailto` contact value (strip `mailto:`), else null.
  - `sender_label` = shared-inbox label for `sender_email` (else null).
  - `guess` = `isGuessSource(mailto.source)` (true only for `source==="pattern"` / `"pattern-catchall"`).
- **ROI (`route.ts:65-71`):** `pct(n,d)` = `round(n/d*1000)/10` (one-decimal %); `replyRate = replied/sent`, `winRate = success/sent`, `replyToWin = success/replied`. `sent` here = initials sent.
- **Response:** `{ counts, roi, upcoming[], upcomingTotal, recent[], recentTotal, followups[], followupsTotal, replied[], repliedTotal, wins[], winsTotal }`. There is no explicit error branch — a thrown query error would surface as an unhandled 500.

##### `getSendingStatus` (`src/lib/db/queries.ts:2226-2310`)

Counts are **all-time** via `head:true` exact-count queries (not derived from the capped lists). Distinct counts:

- `sent` = status `sent` & kind `initial`; `failed` = status `failed` & kind `initial`.
- `replied` = `replied_at not null` & kind `initial`; `bounced` = `bounced_at not null` & kind `initial`.
- `success` = `success_at not null` (**any kind**).
- `scheduled` (= `queuedTotal`) = status `scheduled` & kind `initial`.
- `recentTotal` = status in (`sent`,`failed`), **any kind**.
- `followupsTotal` = kind `followup`, any status.

Lists (all select `SEND_COLS`, joined author/domain/contacts):
- **upcoming:** scheduled initials, `scheduled_at` asc, ranged by offset/limit.
- **recent:** sent+failed (any kind), `sent_at` desc (`nullsFirst:false`).
- **followups:** kind followup, `sent_at` desc **`nullsFirst:true`** — so scheduled (null `sent_at`) ones sort to the top.
- **replied:** `replied_at not null` (any kind), `replied_at` desc; total = `cReplied` (initials only — see caution).
- **wins:** `success_at not null`, `success_at` desc; total = `cSuccess`.

Follow-ups are deliberately excluded from Queued and Sent-initial counts so they only surface in their own tab and don't inflate ROI denominators (`queries.ts:2258-2260`).

#### `POST /api/emails/reschedule` (`src/app/api/emails/reschedule/route.ts`, `maxDuration = 120`)

- **Body:** `{ timezone }`. If missing or not a string → **400 `{ error:"timezone required" }`**.
- Calls `rescheduleScheduledToTimezone(timezone)` → **200 `{ ok:true, rescheduled:<count>, timezone }`**. Any throw → **500 `{ error:e.message }`**.

##### `rescheduleScheduledToTimezone` (`queries.ts:2199-2219`)

Fetches **all** rows with status `scheduled`, groups them by `workflow_id` (in current `scheduled_at` order), and for each workflow recomputes the queue with `computeSmartSchedule`, passing **that one timezone for every recipient** (`tz: timezone`), the workflow's own config (window/gap/cap) with `timezone` overridden, and `now = new Date()`. It writes the new times via `scheduleWorkflowEmails` and persists the tz to each workflow's `email_send_config`. Returns the number of rows moved.

#### `GET | PATCH /api/emails/followups` (`src/app/api/emails/followups/route.ts`)

- Both check `signedIn()` (`auth()`); not signed in → **401 `{ error:"not signed in" }`**.
- **GET** → `{ enabled: <followupsEnabled()> }`.
- **PATCH** `{ enabled }` → coerces to boolean, `setFollowupsEnabled(!!enabled)`, returns `{ enabled }`. A missing/invalid body defaults to `{}` → `enabled` falsy.
- Backed by Redis key `followups:enabled` (`src/lib/email/followup.ts:10-22`). **Default is ON**: `followupsEnabled()` returns true when the key is null/undefined **or when Redis is not configured** — and `setFollowupsEnabled` is a **no-op without Redis** (see caution).

#### `GET | PATCH /api/emails/[id]` (`src/app/api/emails/[id]/route.ts`)

- **GET** → `getOutreachEmail(id)` (full row incl. body, author, domain). Not found → **404 `{ error:"not found" }`**.
- **PATCH** → `updateOutreachEmail(id, body)` with the **raw request body** passed straight into a Supabase `.update()`. On success **`{ ok:true }`**, on throw **500 `{ error:e.message }`**. The client uses this for edit, reschedule, cancel-to-`ready`, win set/clear. Fields are typed in `updateOutreachEmail` (`queries.ts:1519-1541`) but not runtime-whitelisted at the route — the body determines exactly which columns get written (see caution).

#### `POST /api/emails/[id]/followup-toggle` (`src/app/api/emails/[id]/followup-toggle/route.ts`)

- **Body:** `{ armed:boolean }` (coerced with `!!`). Calls `setFollowupArmed(id, armed)`.
- Returns **`{ ok:true }`**, or **400 `{ error }`** when `setFollowupArmed` rejects ("not a follow-up" / "already sent"), or **500** on a thrown error.

##### `setFollowupArmed` (`queries.ts:1682-1696`)

- Loads the row; if it doesn't exist or `kind !== "followup"` → `{ ok:false, error:"not a follow-up" }`; if `status === "sent"` → `{ ok:false, error:"already sent" }`.
- **arm (true):** set `status:"scheduled"`, `scheduled_at = now + FOLLOWUP_LEAD_MS (24h)`, clear `error`; clear the **parent's** `followup_skipped` so `runFollowups` can regenerate. Note: re-arming always resets the send time to 24h out, ignoring any original schedule.
- **disarm (false):** set `status:"draft"`, `scheduled_at:null`; set the **parent's** `followup_skipped = true` so a new follow-up is never regenerated. Only meaningful while unsent.

#### `POST /api/emails/[id]/send-now` (`src/app/api/emails/[id]/send-now/route.ts`, `maxDuration = 60`)

Sends one queued email immediately, ignoring its scheduled time, from the stamped sender's own Gmail. Ordered logic:

1. **Per-email Redis lock** `lock:send:<id>` (TTL 90s, token `sn-<id>`) via `acquireLock`. If not acquired → **`{ ok:false, error:"This email is already being sent." }`** — this is what prevents a click racing the cron processor or a second click. Released in `finally`.
2. `getOutreachEmailWithRecipient(id)`; not found → **404 `{ error:"not found" }`**. (`recipient` here prefers `recipient_override` over the mailto contact, `queries.ts:1471-1482`.)
3. Already `sent` → **`{ ok:true, already:true }`** (idempotent).
4. No `recipient` → mark `status:"failed", error:"No recipient email address"` → **`{ ok:false, error:… }`**.
5. **Role/generic address** (`isRoleEmail(recipient)`) → mark `status:"failed", error:"Skipped: generic/role address (not a person)", followup_skipped:true` → **`{ ok:false, error:"generic/role address — not sent" }`**.
6. `isThreadReply` = kind `followup` or `negotiation`.
7. **Send-time duplicate-inbox guard** (INITIALS only): if `!isThreadReply && !recipient_override && addressHasOtherSentInitial(recipient, id)` → mark `status:"failed", error:"Skipped: recipient inbox already contacted in another campaign", followup_skipped:true` → **`{ ok:false, error:"This inbox was already contacted in another campaign — not sent." }`**. Not silent: the caller gets a clear reason.
8. If a thread reply with a `parent_id`: load `getFollowupParent`. For a **followup** (not negotiation) whose parent already `replied_at`/`success_at` → park it (`status:"draft", scheduled_at:null`) → **`{ ok:false, error:"Recipient already replied — follow-up skipped." }`**. Set `inReplyTo = parent.message_id` for threading.
9. `deliverOutreach({ to, subject, body, sender, sentBy, inReplyTo, references })`.
   - On **ok:** `status:"sent", sent_at:now, message_id`; and **`incrDailyCount(sender, today)`** so manual sends count toward the sender's daily cap (send-now does **not** pre-check the cap — manual override) → **`{ ok:true }`**.
   - On **fail:** `status:"failed", error` → **`{ ok:false, error }`**.

##### `addressHasOtherSentInitial` (`queries.ts:142-156`)

Normalizes the recipient (`strip mailto:`, trim, lowercase). Queries `outreach_emails` for a row that is `status="sent"`, `(kind="initial" OR kind IS NULL)`, `recipient_override IS NULL`, joined author `contacts.type="mailto"` with `value ILIKE "mailto:<clean>"`, `id != excludeId`, `limit 1`. Returns whether such a row exists. So: initials only; overrides (test sends) never count and are never blocked; follow-ups/negotiation replies bypass the guard entirely.

#### `POST | GET /api/emails/process` (`src/app/api/emails/process/route.ts`, `maxDuration = 300`)

Invoked by the header **Process now** button and by cron/QStash. `GET` just calls `POST`.

- **`authorized`:** true if no `CRON_SECRET` (local dev), or Bearer/`?key=` matches the secret (cron/QStash), or a valid `auth()` session (the button). Else **401 `{ error:"unauthorized" }`**.
- **Global lock** `lock:emails:process` (TTL 290s). If held → **`{ skipped:"another send run is in progress" }`** (the button toast becomes "A send run is already in progress.").
- Runs **reply detection first** (`runReplyDetection`, read-only, never blocks sending) so a due follow-up sees the freshest reply status.
- `getDueEmails(50)` = status `scheduled` & `scheduled_at <= now`, ascending (`queries.ts:2436-2453`; recipient prefers `recipient_override`). For each: no recipient → failed; role address → failed + `followup_skipped`; **same send-time duplicate-inbox guard** (initials, `dupSkipped++`); follow-up parent-replied guard → park to draft; per-sender cap via `getDailyCount(sender, day) >= cap` → `cappedSkipped++` (hard block); then send via `sendEmailAs` (per-user Gmail) or `sendEmail` (legacy env SMTP), stamp `sent`/`failed`, and `incrDailyCount(sender ?? workflow_id, day)`.
- Then **auto-negotiation** (only if `ai_autonomy` on) and **`runFollowups()`** (schedules day-2 nudges, respecting the kill switch).
- Response: `{ due, sent, failed, cappedSkipped, dupSkipped, replies, negotiations, followups, results }`.

---

### The smart scheduling algorithm (`src/lib/email/schedule.ts`)

`computeSmartSchedule(recipients, config, now)` assigns each email a UTC send instant such that: **every email lands inside its recipient's LOCAL `[startH, endH)` window**, all sends (sharing one account) are spaced `>= gap_minutes` apart **globally**, and no more than `daily_cap` land on any single **UTC calendar day**. It is greedy by each recipient's earliest local slot.

Config resolution (`schedule.ts:81-89`):
- `startH` = `clampHour(send_hour_start, 9)` (clamped 0–23).
- `endH` = `max(startH+1, clampHour(send_hour_end, 17))` — always at least one hour after start.
- `gapMs` = `max(1, gap_minutes || 15) * 60000`.
- `cap` = `max(1, daily_cap || 50)`.

Steps:
1. For each recipient compute `earliest` via `earliestFor(now, tz, startH, endH)`: if before today's window → today's window start; if at/after `endH` → tomorrow's window start; if inside → `now` (`schedule.ts:61-66`).
2. Sort recipients by `earliest` ascending.
3. Greedy loop: candidate = `max(earliest, lastSlot + gap)`. A normalization loop (bounded to 800 iterations to avoid pathological spins) then repeatedly fixes the candidate: (a) if outside the window, jump to today's start (if before `startH`) or next day's start; (b) if it violates the gap, push to `lastSlot + gap`; (c) if that UTC day is already at `cap`, jump to the recipient's next-day window start. Break when all three pass.
4. Record the slot, advance `lastSlot`, increment that UTC day's count. Finally sort output by time (`schedule.ts:124-130`).

Timezone plumbing: `partsInTz`/`utcFromLocal`/`localHour` convert between a wall-clock time in an IANA zone and a UTC epoch using `Intl.DateTimeFormat` (`schedule.ts:16-57`), so DST and offset are handled per-instant. The recipient tz comes from `author.timezone` or `inferTimezone(host, country, fallback)` (`src/lib/email/timezones.ts`), which maps ccTLDs and explicit country strings to a representative IANA zone; neutral TLDs (`.com/.org/.io/.ai/.co/.app/.dev/.info/.biz/.me/.xyz`) give no signal and fall through to the fallback ("America/New_York").

Two important scoping notes:
- The **daily cap is bucketed by UTC day** (`utcDayKey`), while the **window is evaluated in each recipient's local day** — so "per sender per day" as shown in the UI is really per-UTC-day across the whole batch, with local-time windows.
- `computeSmartSchedule` is used both at compose/schedule time (elsewhere) and by "Apply timezone", which forces one tz for everyone.

---

### Role / generic address parking (`src/lib/email/roleEmail.ts`)

`isRoleEmail(raw)` detects non-person mailboxes so they are never pitched: strips `mailto:`, drops any `+tag`, collapses the local-part to `[a-z0-9]` only, then flags it if the collapsed local-part **exactly** matches a large `EXACT` set (press, pr, info, hello, contact, editor, tips, team, support, admin, marketing, sales, brand, licensing, legal, careers, hr, billing, noreply, no-reply, git, api, newsletter, submissions, obits, bot, …) or **contains** any distinctive `CONTAINS` stem (pressinquir, brandlicens, mediarelation, newsroom, donotreply, mailerdaemon, unsubscribe, submiss, inquir, enquir, editorial, newsdesk, customercare, …). An empty collapsed local-part is treated as generic.

Enforcement is layered:
- **At storage:** `upsertContact` refuses to store a `mailto` contact that is a role email (`queries.ts:120-133`) — role addresses generally never even become a recipient.
- **At send (belt-and-suspenders):** both `send-now` and the `process` loop re-check `isRoleEmail(recipient)` and, if true, mark the email `failed` with error "Skipped: generic/role address (not a person)" **and** `followup_skipped:true` so no follow-up is scheduled.
- The enrich/finder path shares the same canonical detector via `src/lib/enrich/personFilter.ts` (`isRoleEmail` delegates to the canonical function; `isLikelyPersonName` separately rejects company/section "authors").

---

### Delivery pipeline (`src/lib/email/deliver.ts`, `src/lib/email/smtp.ts`)

`deliverOutreach({ to, subject, body, sender, sentBy, inReplyTo, references })`:
- If a `sender` is set, decrypt that user's Gmail app password (`getUserAppPasswordEnc` + `decryptSecret`). **No password → `{ ok:false, error:"<sender> hasn't set a Gmail app password (Settings → Your sending email)" }`** (nothing is sent). Otherwise `sendEmailAs` with the sender's `from_name`.
- If no `sender` (legacy/unstamped), falls back to the shared server SMTP identity via `sendEmail`.
- **CC:** when `sentBy` differs from `sender` (a shared-inbox send), `sentBy` is CC'd so the initiator sees replies and can reply.

`smtp.ts`:
- `getTransport()` builds one reusable transport from `SMTP_HOST/USER/PASS` (port 465 implicit TLS by default, 587 = STARTTLS). Missing env → returns null → `sendEmail` fails with "SMTP not configured".
- `sendEmailAs` builds a **throwaway** `smtp.gmail.com:465` transport per send (correct even if the password changed), sets `inReplyTo`/`references` for threading, and closes the transport after.
- Body is sent as text plus a minimal HTML version: `htmlify` escapes `&` and `<` and converts `\n` → `<br>` (note: `>` is not escaped).
- `verifyGmail` / `verifyTransport` support the Settings "test connection" without sending.

---

### Automatic follow-ups (`src/lib/email/followup.ts`)

- `runFollowups(force=false)` (called by the process loop) is skipped when the global kill switch is off (unless `force`). Candidates come from `getEmailsNeedingFollowup(FOLLOWUP_DAYS=2, 50)`: `status="sent"`, `kind="initial"`, no `replied_at`, no `success_at`, `followup_skipped=false`, `sent_at <= now-2d`, and **no existing follow-up child**; it over-fetches `limit*3` then filters (`queries.ts:1610-1657`).
- For each, it generates a short nudge body via OpenRouter (`anthropic/claude-haiku-4-5`, 20s timeout) with a plain-text fallback if the key is missing/short or output is empty/contains placeholders (`followup.ts:29-61`). Subject becomes `Re: <original>` (idempotent). It then **schedules** (does not send) a `kind="followup"` row via `createFollowupRow` with `status:"scheduled"`, `scheduled_at = now + FOLLOWUP_LEAD_MS (24h)` — giving a visible date and a window to toggle off. The normal processor delivers it threaded when due.

---

### Key checks & validations

- **Duplicate-inbox guard (initials only, send-time):** `addressHasOtherSentInitial` — never send an initial to an inbox already sent an initial from another thread; excludes overrides and thread replies. Applied identically in `send-now` and `process`.
- **Role-address guard:** `isRoleEmail` at storage and at send; parks with `followup_skipped`.
- **Missing recipient:** parked as `failed` with a clear error.
- **Follow-up parent-replied guard:** a nudge is dropped to `draft` (not failed) if the recipient replied/converted since it was scheduled; negotiation replies always proceed.
- **Per-email send lock:** `lock:send:<id>` blocks concurrent/racing sends of the same email.
- **Global process lock:** `lock:emails:process` blocks overlapping batch runs.
- **Daily cap:** enforced hard at send time in the cron loop (per-sender, per UTC day); respected by the scheduler; and incremented (not pre-checked) by send-now.
- **Timezone validation:** reschedule route requires a non-empty string; the scheduler clamps window hours and forces `endH > startH`.
- **Reschedule input:** `datetime-local` is interpreted in the browser's local zone and converted to ISO; no window/cap validation on a manual reschedule.

---

### Flows

**1. Automatic drip send (happy path)**
1. Emails are composed and `computeSmartSchedule` assigns each a `scheduled_at` inside the recipient's local window, gap-spaced, cap-limited. Rows are `status="scheduled", kind="initial"`.
2. Cron/QStash (or the Process now button) calls `POST /api/emails/process`. It acquires the global lock, runs reply detection, then `getDueEmails(50)`.
3. For each due email it passes the role-address, duplicate-inbox, and (for follow-ups) parent-replied guards, checks the per-sender daily cap, and delivers via the sender's Gmail (CC'ing `sentBy` for shared inboxes).
4. Success stamps `status="sent", sent_at, message_id` and increments the daily count; failure stamps `status="failed", error`.
5. The Sending page's 5s poll moves the row from **Queued** to **Sent & failed**.

**2. Manual "Send now"**
1. User clicks Send on a queued (or armed follow-up) row → `POST /api/emails/[id]/send-now`.
2. The per-email lock is taken; guards run (idempotent sent-check, recipient, role, duplicate-inbox, follow-up parent-replied); delivery runs; the row flips to sent/failed and the daily count is incremented; toast reflects the outcome.

**3. Reschedule / cancel a queued send**
1. Reschedule: user picks a local datetime → `PATCH /api/emails/[id] { scheduled_at:ISO, status:"scheduled" }`; the row keeps its place in Queued at the new time.
2. Cancel: `PATCH /api/emails/[id] { status:"ready", scheduled_at:null }`; the row leaves Queued and is not shown elsewhere on this page.

**4. Restandardize the whole queue to one timezone**
1. User picks a tz and clicks Apply (enabled only if something is queued) → `POST /api/emails/reschedule { timezone }`.
2. `rescheduleScheduledToTimezone` regroups all scheduled rows by workflow, recomputes each with that single tz for every recipient (starting from `now`), rewrites `scheduled_at`, and persists the tz to each workflow config; toast reports the count.

**5. Auto follow-up lifecycle**
1. Process run: an initial sent >2 days ago with no reply/win and no existing follow-up gets a `kind="followup"` row generated and **scheduled 24h out** (unless the kill switch is off).
2. It appears armed in the Follow-ups tab. The user can toggle it off (→ draft, parent `followup_skipped=true`), edit it, or Send now.
3. When due, the processor delivers it threaded via `In-Reply-To` — but drops it to draft if the recipient has since replied.

**6. Mark a win**
1. On a sent (non-bounced) row, user clicks Win → dialog → `PATCH /api/emails/[id] { success_at, success_link, success_notes }`.
2. It appears in the Wins tab and lifts Wins / Win rate / Reply→Win stats. Remove win clears the three fields.

---

### Edge cases & cautions

- **No per-user authorization on the data/action routes.** `status`, `reschedule`, `[id]` GET/PATCH, `followup-toggle`, and `send-now` rely solely on the `proxy.ts` session gate; they never re-check the session or scope to the acting user. Any signed-in user can read/edit/send/reschedule any email, including other users' shared-inbox sends. Only `process` and `followups` re-check `auth()`.
- **`PATCH /api/emails/[id]` writes the raw body.** The request body is passed straight into a Supabase `.update()`; the TS type on `updateOutreachEmail` documents intended fields but does not enforce them at runtime, so a crafted body could set arbitrary columns. The client only ever sends benign field sets.
- **Cancel parks to `status:"ready"` with no UI path back.** Cancelled emails leave the Queued tab (which filters `status="scheduled"`) and appear in no tab on the Sending page, yet the toast says "won't be sent until you re-schedule" — but there is no re-schedule affordance for `ready` emails here. They are effectively orphaned from this screen.
- **Redis is load-bearing for safety.** Without Redis (`redis()===null`): `acquireLock` always returns true (so the per-email send lock and the global process lock are no-ops — relying on a single-instance assumption); `getDailyCount`/`incrDailyCount` return 0 (so the **send-time daily cap is not enforced**); and the follow-up kill switch is stuck ON (`followupsEnabled` defaults true, `setFollowupsEnabled` is a no-op). In serverless (multiple instances) without Redis, overlapping triggers could double-send.
- **Two different daily caps.** The scheduler uses the **workflow** `email_send_config.daily_cap` (default 50); the send-time hard block uses the **per-sender** `user_email_config.daily_cap`. They can diverge.
- **"Apply timezone" flattens per-recipient tz.** It forces the chosen tz for every recipient and re-times from `now`, so recipient-local accuracy is lost and everything can bunch forward starting immediately. It also overwrites each workflow's stored tz.
- **Display tz vs. scheduled tz can mismatch after Apply.** The status route computes `local_label` from `author.timezone ?? inferred`, but Apply schedules using the forced tz and does not change `author.timezone`. So a row's displayed local time may be labeled in a different zone than the one used to place it — the instant is correct, the label may look off-window.
- **Manual reschedule bypasses the scheduler.** A hand-picked `scheduled_at` isn't validated against the send window or the cap; it will still be sent when due (subject only to the send-time cap and guards).
- **Send-now does not pre-check the daily cap** (by design — it's a manual override) but does count toward it, so a burst of manual sends can push the sender over cap for that day, throttling the automated queue afterward.
- **Replied tab count vs. list mismatch.** `repliedTotal` counts initials only (`cReplied`), but the replied **list** query has no `kind` filter, so a follow-up carrying `replied_at` could appear in the list without being counted (rare, since replies are recorded on the initial anchor).
- **Guess badge is display-only.** A "guess" (pattern-constructed) address is still sent unless it also trips the role-address or duplicate-inbox guard — the badge is a warning, not a block.
- **Follow-up re-arm resets timing.** `setFollowupArmed(true)` always reschedules to `now + 24h`, discarding any earlier scheduled time.
- **HTML escaping is partial.** `htmlify`/`sendEmail` escape `&` and `<` but not `>`; bodies are plain author-authored text so this is low-risk, but worth knowing.
- **Bounces vs. replies.** Bounces and auto-replies are excluded from the Replies tab/stat and surface under Sent & failed; the reply/bounce classification lives on `reply_kind`, `bounced_at`, `replied_at`, populated by IMAP reply detection, not by this area.
- **Status route has no error branch.** A DB failure in `getSendingStatus` bubbles up unhandled; the client `load()` swallows fetch/JSON errors in a bare `catch {}`, so a failing poll silently leaves stale data on screen.

---

## Negotiation (AI Reply Handling)

### Purpose

The Negotiation area is where inbound replies to outreach emails are triaged and answered. Once an initial outreach email has produced *engagement* (a human reply, a bounce, an auto-responder, or has been marked AI-managed), it surfaces here. An LLM "negotiator" reads the whole email thread, classifies what the other side said (interested / counter-offer / accept / question / hard no / unsubscribe / auto / irrelevant), and drafts the next reply. That reply either (a) is saved as a draft for a human to review and send, or (b) is sent automatically — depending on the global **autonomy** switch. The negotiator never offers more than the site's DR-based price ceiling, always tries to pay the least (or nothing), and will never auto-send a reply to a hard-no or unsubscribe.

Key source files:
- Page UI: `src/app/negotiation/page.tsx`
- List/triage API: `src/app/api/negotiation/threads/route.ts`
- Per-thread conversation + send/discard: `src/app/api/negotiation/[id]/route.ts`
- Generate reply: `src/app/api/negotiation/draft/route.ts`
- Settings (handbook/pricing/autonomy): `src/app/api/negotiation/settings/route.ts`
- Bulk enable/disable AI on threads: `src/app/api/emails/ai-manage/route.ts`
- Core negotiation orchestration: `src/lib/negotiation/run.ts`
- The LLM agent (classify + draft + sanitize): `src/lib/negotiation/agent.ts`
- Pricing tiers by DR: `src/lib/negotiation/pricing.ts`
- Settings model + defaults: `src/lib/negotiation/settings.ts`
- Batch processor that auto-negotiates: `src/app/api/emails/process/route.ts`
- Reply detection (IMAP) feeding the queue: `src/lib/email/imap.ts`, `recordReplyOnAnchor` in `src/lib/db/queries.ts`

---

### UI walkthrough — `src/app/negotiation/page.tsx`

The page is a client component. On mount it calls `load()` (`page.tsx:64`) which fetches `GET /api/negotiation/threads` and stores `threads`, `autonomy`, and `currency`.

#### Header (`page.tsx:227-242`)
- **Title** "Negotiation" with a `Bot` icon and subtitle: "Replies triaged by state. The AI negotiates within each site's DR-based ceiling and your Handbook."
- **Autonomy badge** (`page.tsx:233`): read-only indicator driven by the fetched `autonomy` flag. When ON it is amber and reads **"Autonomy ON — AI sends itself"**; when OFF it is muted and reads **"Autonomy OFF — AI drafts for approval"**. This badge only *reflects* the setting; it is not a toggle (the toggle lives on the Handbook page).
- **"Process now" button** (`page.tsx:236`): calls `processNow()` → `POST /api/emails/process`. This runs the same batch pipeline as the Sending page: IMAP reply detection, then (if autonomy is on) auto-negotiation, then auto follow-ups. On success it toasts `Checked replies (N new)` plus, if any negotiations happened, ` · AI: X sent, Y drafted`. On error toasts "Process failed". Shows a spinner while `processing` is true.
- **"Handbook" link** (`page.tsx:239`): navigates to `/handbook`, where autonomy, tone, aggressiveness, opening percent, style rules, max thread length, floor price, currency, anti-highball text, and the DR pricing tiers are edited.
- **Refresh icon button** (`page.tsx:240`): re-runs `load()`.

#### Category tabs (`page.tsx:244-251`)
Seven buckets defined in `CATS` (`page.tsx:32-40`): **Queued**, **Needs reply**, **Negotiating**, **Agreed**, **Hard no**, **Automated**, **Bounced**. Each tab shows a live count from `countFor(k)` (`page.tsx:90`), which counts `threads` whose `category === k`. Clicking a tab sets `tab` and clears the current selection (`clearSel()`). The active tab has a violet underline. Only threads whose `category` matches the active tab are shown (`rows`, `page.tsx:72`).

#### Selection / bulk bar (`page.tsx:253-266`)
- **"Select all (N)"** selects every thread currently visible in the active tab (`selectAllVisible`, `page.tsx:92`); disabled when the bucket is empty.
- **"Clear (N)"** appears only when something is selected; clears the selection.
- When `sel.size > 0`, two bulk actions appear:
  - **"Enable AI (N)"** (violet): opens the price/handbook dialog (`setPriceOpen(true)`).
  - **"Turn AI off"** (`page.tsx:263`): calls `applyAI(false)` → `POST /api/emails/ai-manage` with `managed:false` for the selected ids, then toasts and reloads.

#### Sender grouping (`page.tsx:76-88`, rendered `page.tsx:274-296`)
Within the active tab, threads are grouped by the account that sent them (`t.sender`, i.e. `sender_email`; falls back to key `__default__` / label "Default account"). This mirrors the Sending page layout. Inside each group, items are sorted by most-recent activity descending, and groups themselves are sorted by their newest item. "Activity date" is `dateOf(t)` = `repliedAt ?? bouncedAt ?? sentAt` (`page.tsx:73`).

Each group is a `Card` with a collapsible header (`page.tsx:279-288`) showing a chevron, a `Mail` icon, the sender label, a count badge, and the group's latest activity date. Clicking toggles collapse via `toggleSender`, keyed by `` `${tab}:${g.key}` `` so collapse state is per-tab-per-sender. Collapsed groups hide their rows.

#### Thread row (`renderThread`, `page.tsx:165-223`)
Each row shows:
- **Checkbox** (`page.tsx:168`): toggles the thread in the bulk selection `sel`.
- **Expand chevron** (`page.tsx:169`): `ChevronDown` when open else `ChevronRight`; clicking (or clicking the row body) calls `expand(t)`.
- **Name** (`t.name`) and **publication** (`t.publication`).
- **DR badge** (`page.tsx:176`): shown only when `t.dr != null`, as `DR <rounded>`.
- **Ceiling badge** (`page.tsx:177`): `≤ <currency> <ceiling>` when a ceiling exists, otherwise **"placement-only"** (no paid offer allowed).
- **AI badge** (`page.tsx:178`): violet `Bot` + "AI" when `t.aiManaged` is true.
- **Sentiment badge** (`page.tsx:179`): shows `t.sentiment` (positive = green, negative = red, neutral = muted) using the `SENTIMENT` map. Sentiment is only computed for genuine human replies.
- **Draft-status badge** (`page.tsx:180`): if a negotiation child row exists, shows **"AI replied"** (child status `sent`), **"send failed"** (`failed`), else **"AI draft ready"** (a draft exists).
- **Activity date** (`page.tsx:181`): `fmtDate(dateOf(t))`, e.g. "Jul 20, 03:14 PM".
- **Reply excerpt** (`page.tsx:183`): the first 240 chars of `t.replyExcerpt`, quoted and line-clamped to 2 lines.

Row-level action button on the right:
- For **needs_reply** or **negotiating** threads (`page.tsx:185-189`): a button whose label depends on state — if a draft body already exists it reads **"Regenerate"**; otherwise **"AI reply"** when autonomy is ON (it will send) or **"Draft AI reply"** when OFF. Clicking calls `draft(t)`. Shows a spinner while `busy === t.id`.
- For **queued** threads (`page.tsx:190-194`): no button, just a status hint — "Sent · awaiting reply" (status `sent`), "Queued to send" (status `scheduled`), else the raw status.
- Threads in agreed / hard_no / automated / bounced have no row-level action button.

#### Expanded thread panel (`page.tsx:197-221`)
When a row is expanded, `expand(t)` (`page.tsx:95-104`) lazily fetches `GET /api/negotiation/[id]` to populate `convo[t.id]` (the message list) and, if a draft body is returned, seeds `editBody[t.id]`. It also seeds `editBody` from `t.draftBody` if present. The panel shows:
- **Conversation** (`page.tsx:199-206`): each message rendered as a bubble; our messages ("Us") are violet and right-aligned, theirs (labeled with the author name) are muted and left-aligned. Shows "Loading…" until messages arrive. Messages come from `getConversation` (both our sent bodies and their reply excerpts, oldest first; failed sends are excluded).
- **AI draft editor** (`page.tsx:207-216`): when `editBody[t.id]` is defined, a 7-row `Textarea` prefilled with the draft, plus three buttons:
  - **"Send reply"** (green) → `sendOrDiscard(t, "send")` — sends the (possibly edited) body.
  - **"Regenerate"** → `draft(t)` — re-runs the negotiator.
  - **"Discard"** (ghost) → `sendOrDiscard(t, "discard")` — deletes the draft.
- If there is no draft yet but the thread is needs_reply/negotiating (`page.tsx:217-219`), a single **"Draft AI reply"** button appears.

#### Enable-AI dialog (`page.tsx:300-331`)
Opened by "Enable AI (N)". Title: "Enable AI negotiation for N thread(s)". Description explains the AI defaults to your Handbook (pricing tiers by DR, tone, lowball strategy).
- **"Use Handbook defaults"** switch (`useDefaults`, default true, `page.tsx:308-309`). When ON, no per-thread override is sent.
- When OFF (`page.tsx:311-321`), two inputs appear:
  - **"Max offer override (<currency>)"**: numeric; if set, sent as `max_offer` and overrides the DR tier ceiling for those threads.
  - **"Criteria / notes for these threads"**: free text (e.g. "only pay for a do-follow link"); sent as `criteria` → stored in `negotiation_notes`.
- Footer: **Cancel** and **Enable AI** (calls `applyAI(true)`).

#### Empty / loading states
- While `loading`: centered spinner "Loading…" (`page.tsx:268-269`).
- When a bucket has no rows: **"Nothing in this bucket."** (`page.tsx:270-271`).

#### Client action functions
- `applyAI(managed)` (`page.tsx:106-120`): POSTs `{ ids, managed }` to `/api/emails/ai-manage`. When enabling with `useDefaults` off, adds `max_offer` (only if non-empty) and `criteria` (only if non-empty). Toasts success (noting "(Handbook defaults)" when applicable), closes the dialog, resets the form, clears selection, reloads. Note: this action has **no per-thread error surfacing** — the `fetch` is not response-checked, so a server error still shows a success toast (see Edge cases).
- `draft(t)` (`page.tsx:123-138`): POSTs `{ emailId: t.id }` to `/api/negotiation/draft`. Branches on the response: `r.error` → error toast (returns); `r.sent` → "AI replied and sent (<statusHint>[, offer <cur> <n>])"; `r.sendError` → "AI drafted but send failed: …"; `r.recipientMissing` → "No recipient email on file, saved as draft"; else "Draft ready — review and send below". Seeds `editBody`, forces conversation reload, opens the row, reloads the list, and re-fetches the conversation.
- `processNow()` (`page.tsx:142-152`): described above.
- `sendOrDiscard(t, action)` (`page.tsx:154-163`): POSTs `{ action, body: editBody[t.id] }` to `/api/negotiation/[id]`. On send success toasts "Sent to <to>" and collapses the row; on discard toasts "Draft discarded"; then reloads.

---

### API routes / server logic

#### `GET /api/negotiation/threads` — list & triage (`route.ts`)
- **Method/path**: `GET /api/negotiation/threads`. No explicit auth check in the handler.
- **Logic**: loads negotiation settings, then selects up to 1000 `outreach_emails` rows where `kind = 'initial'`, ordered by `sent_at` desc, joining author + domain (host, name, dr, organic_traffic, us_traffic_share). It **filters in memory** to rows that have engagement: `replied_at || bounced_at || ai_managed || negotiation_status` (`route.ts:19`). For those, it batch-loads the latest `kind='negotiation'` child per parent (in chunks of 300 ids), keeping only the newest child per `parent_id` (`route.ts:23-30`).
- **Ceiling** per thread: `max_offer` if set on the row, else `maxOfferFor(dr, traffic, usShare, pricing_rules)?.offer`, else null (`route.ts:35`).
- **Bucketing** (`route.ts:40-46`), first match wins in this order:
  1. `bounced_at` → **bounced**
  2. `reply_kind === "auto"` → **automated**
  3. `negotiation_status === "declined"` → **hard_no**
  4. `negotiation_status === "agreed"` → **agreed**
  5. `replied_at` present → **negotiating** if the latest negotiation child's status is `sent` (we already answered), else **needs_reply**
  6. otherwise → **queued** (AI-managed but no reply yet; scheduled or sent, waiting on them)
- **Response**: `{ threads: [...], autonomy: settings.ai_autonomy, currency: settings.currency }`. Each thread object includes id, authorId, name, publication, host, dr, ceiling, category, replyKind, sentiment, repliedAt, bouncedAt, sentAt, negotiationStatus, aiManaged, subject, replyExcerpt, sender (=sender_email), draftStatus, draftBody, and `status`.
- **Error branch**: any thrown error → `{ error: message }` with HTTP 500 (`route.ts:61-63`).

#### `GET /api/negotiation/[id]` — conversation + current draft (`[id]/route.ts:10-23`)
- **Path**: `GET /api/negotiation/{id}` where `id` is the anchor (initial) email id. `maxDuration = 60`. No auth check.
- **Logic**: in parallel, `getConversation(id)` (all rows where `id = anchor` OR `parent_id = anchor`, oldest first: our bodies + their reply excerpts, failed sends excluded) and the latest `kind='negotiation'` child row (`id, body, status, subject, created_at`).
- **Response**: `{ conversation, draft }` (draft is null if none). Error → `{ error }` 500.

#### `POST /api/negotiation/[id]` — send or discard the draft (`[id]/route.ts:27-65`)
- **Body**: `{ action: 'send' | 'discard', body?: string }`.
- **Logic**: loads the latest `kind='negotiation'` child of this anchor whose status is `draft` or `failed`.
  - No such draft → `{ error: "No draft to act on" }` **404**.
  - `action === "discard"` → deletes that row, returns `{ ok:true, discarded:true }`.
  - `action` not "send" → `{ error: "bad action" }` **400**.
  - `action === "send"`: body to send = the edited body if a non-empty string, else the draft's stored body. Resolves recipient from `recipient_override` (trimmed) or the author's `contacts` row of type `mailto` (strips `mailto:`). No recipient → `{ error: "No recipient email on file for this author" }` **400**. Pulls the parent's `message_id` for threading. Calls `deliverOutreach({ to, subject, body, sender, sentBy, inReplyTo, references })`.
    - On send failure: updates the draft row to `status:"failed"`, stores `error` and the body; returns `{ error }` **500**.
    - On success: updates the row to `status:"sent"`, sets `sent_at`, `message_id`, clears error, stores the body; returns `{ ok:true, sent:true, to: recipient }`.
- Any thrown error → `{ error }` **500**.

#### `POST /api/negotiation/draft` — generate the next reply (`draft/route.ts:9-23`)
- **Body**: `{ emailId, send? }`. `maxDuration = 60`. No auth check.
- **Validation**: missing `emailId` → `{ error: "emailId required" }` **400**.
- **Logic**: delegates to `negotiateThread(emailId, { forceDraft: send === false })`. Note the mapping: passing `send:false` forces draft-only even if autonomy is on; **any other value of `send` (including omitting it) does NOT force a send** — actual sending is decided inside `negotiateThread` by the autonomy setting. The page only ever sends `{ emailId }`.
- **Response**: `{ ok, draftId, body, classification:{intent}, ceiling, suggestedOffer, statusHint, autonomy, persistedAs, sent, sendError, recipientMissing }`.
- **Error branches**: `!r.ok` → `{ error }` with **404** when the message wasn't found, else **400**. Thrown error → **500**.

#### `GET/PUT /api/negotiation/settings` (`settings/route.ts`)
- **GET**: returns `getNegotiationSettings()` (the merged handbook/pricing/autonomy config). Error → `{ error }` 500.
- **PUT**: `saveNegotiationSettings(body)` upserts any subset of `ai_autonomy, handbook, tone, aggressiveness, opening_percent, style_rules, max_thread_length, min_price, currency, anti_highball, pricing_rules` (row keyed by singleton `id = true`; `pricing_rules` stored as JSON). Returns the reloaded settings. Error → `{ error }` 500. No auth check. This is the endpoint the Handbook page uses; the Negotiation page only reads settings via the threads route.

#### `POST /api/emails/ai-manage` — bulk enable/disable AI on threads (`ai-manage/route.ts`)
- **Body**: `{ ids?: string[], all?: true, managed?: boolean, max_offer?: number|null, criteria?: string }`.
- **Logic**: `managed` defaults to true (only `managed:false` disables). Builds a patch: `{ ai_managed: managed }`, plus `max_offer` (if provided; `null` clears it, else `Number(...)`) and `negotiation_notes` (if `criteria` is a string). Applies to the given `ids`, or — when `all:true` — to every `kind='initial'` with `status='sent'`. Neither provided → `{ error: "provide ids[] or all:true" }` **400**.
- **Response**: `{ ok:true, updated: <count>, managed }`. Supabase error thrown → `{ error }` **500**. No auth check.

---

### Core negotiation logic — `src/lib/negotiation/run.ts` (`negotiateThread`)

This is the shared engine used by both the page's Draft button and the batch processor's auto-negotiation loop. `opts.forceDraft` = never auto-send even when autonomy is on.

1. Load the email by id (id, kind, parent_id, subject, author_id, sender_email, sent_by_email, max_offer, joined author+domain). Not found → `{ error: "email not found" }`.
2. Determine the thread anchor `initialId`: for a `followup`/`negotiation` row use its `parent_id` (fallback to its own id), else the row itself (`run.ts:27-28`).
3. Load all thread rows where `id = initialId` OR `parent_id = initialId`, oldest first. Build the `ThreadMessage[]` conversation: every row's `body` becomes a `{from:"us"}` message; every `reply_excerpt` becomes a `{from:"them"}` message, and the last such row is remembered as `latestReply` (`run.ts:38-43`).
4. Load negotiation settings. Classify the latest reply's intent via `classifyReplyIntent(latestReply.reply_excerpt, reply_subject)`.
5. Compute the price ceiling: the row's `max_offer` if set, else the DR tier's offer, else null (placement-only) (`run.ts:48-49`).
6. Draft the reply via `draftNegotiationReply(...)` passing settings, thread, author first-name/publication, ceiling, floor (`settings.min_price`), the classified intent, and any price they named. If the agent returns null (no `OPENROUTER_API_KEY`) → `{ error: "No OPENROUTER_API_KEY configured" }` with ceiling/intent populated.
7. Build the subject: reuse the initial subject if it already starts with `re:`, else prefix `Re: ` (`run.ts:59`).
8. **Autonomy gate** (`run.ts:60`): `autonomy = settings.ai_autonomy && !forceDraft && intent !== "hard_no" && intent !== "unsubscribe"`. So even with autonomy globally on, a hard-no / unsubscribe reply is never auto-sent — it is only ever saved as a draft.
9. Resolve recipient: the initial's `recipient_override` (test-send address, keeps the whole AI thread on the test inbox) or the author's `mailto` contact (`run.ts:62-65`). Pull the initial's `message_id` for threading.
10. **Clear any prior UNSENT draft**: deletes existing `kind='negotiation'`, `status='draft'` children of this anchor so stale drafts never pile up (`run.ts:69`).
11. If `autonomy && recipient`: call `deliverOutreach(...)` with `inReplyTo`/`references` = parent Message-ID; status becomes `sent` on success or `failed` on error (errors are caught and captured, never thrown) (`run.ts:73-76`).
12. Insert a new `kind='negotiation'` child row with the draft body, computed status, sender/sentBy, `recipient_override` copied from the initial, `ai_managed:true`, `max_offer: ceiling`, and `negotiation_status: draft.statusHint`. `sent_at`/`message_id`/`error` set according to status (`run.ts:78-87`).
13. Update the **anchor (initial)** row: `negotiation_status = statusHint`, a human-readable `negotiation_notes` summary (their intent + reason, our offer, ceiling), and — when the deal is **agreed** — `agreed_price` (the suggested offer or the price they named) and `payment_status = "owed"` (only if there's a price) (`run.ts:89-94`). This is what promotes the thread into the Agreed bucket and into the Payments view.
14. Return the full `NegotiationResult`, including `sent`, `sendError`, and `recipientMissing` (true when autonomy wanted to send but no recipient was on file — so it fell back to a saved draft).

---

### The agent — `src/lib/negotiation/agent.ts`

#### LLM transport (`agent.ts:4-20`)
`llm(prompt, maxTokens, temperature)` calls OpenRouter's chat-completions with model **`anthropic/claude-haiku-4-5`**, a 25-second timeout, and returns the trimmed content or **null** if there is no key (`OPENROUTER_API_KEY` missing or shorter than 20 chars), the request is not `ok`, or anything throws. It never throws.

#### `sanitizeBody` (`agent.ts:24-34`) — the "no em dashes" rule, enforced in code
Applied to *every* generated body regardless of what the model returns. It replaces em/en dashes (`—`/`–`) with commas, tidies `" ,"`→`","` and doubled commas, collapses runs of spaces/tabs, strips trailing whitespace before newlines, collapses 3+ blank lines to a double newline, and trims. This is a hard guarantee independent of the prompt's style rules.

#### `classifyReplyIntent(replyText, subject)` (`agent.ts:55-97`)
Returns `{ intent, priceMentioned, reason }`. Sends subject+body (capped at 4000 chars) to the LLM asking for compact JSON with an `intent` from the fixed set (`interested`, `counter_offer`, `accept`, `question`, `hard_no`, `unsubscribe`, `auto`, `irrelevant`), a numeric `priceMentioned` or null, and a short reason. It extracts the first `{...}` block and validates the intent against the allowed list (defaulting invalid values to `interested`).

**Heuristic fallback** (no LLM key or parse failure, `agent.ts:86-96`): a regex pulls a `$`-figure as `priceMentioned`; intent is decided by keyword: unsubscribe/remove-me/stop-emailing/do-not-contact → `unsubscribe`; not-interested/no-thank/we-don't/won't-be-able/pass/decline → `hard_no`; out-of-office/auto-reply/no-reply → `auto`; a mentioned price → `counter_offer`; a question pattern → `question`; else `interested`. `reason` = "heuristic".

#### `draftNegotiationReply(input)` (`agent.ts:122-201`)
Inputs: settings, thread, authorName, publication, ceiling, floor, lastIntent, theirPrice, senderName. Uses the author's first name and a signer name (`input.senderName` or default **"Abdullah"**). `overLength` is true once `usCount >= settings.max_thread_length`.

Short-circuit branches (no LLM call needed):
- **hard_no / unsubscribe** (`agent.ts:129-134`): returns a fixed polite "totally understand… door is open" message, `suggestedOffer:null`, `shouldStop:true`, `statusHint:"declined"`.
- **accept with a payable named price** (`agent.ts:141-146`): if intent is `accept`, they named a price, it's ≥ floor and (ceiling null OR ≤ ceiling), it closes at *their* number: "Perfect, <cur> <price> works…", `statusHint:"agreed"`, `shouldStop:true`. This deliberately avoids lowballing after a yes. If their accepted price is *above* the ceiling, this branch is skipped and it falls through to let the model counter down.
- **accept with no named price but a ceiling exists** (`agent.ts:148-155`): closes at the lowball opening = `max(floor, floor + (ceiling-floor) * openingPct/100)`, `statusHint:"agreed"`, `shouldStop:true`.

Otherwise it builds a prompt (`agent.ts:157-184`):
- Opening number = `max(floor, round(floor + (ceiling-floor) * openingPct/100))`; `opening_percent` is clamped to 0..100.
- **Aggressiveness** text from the `AGGRESSION` map (gentle / balanced / firm; unknown → balanced).
- **Price guidance**: if ceiling is null → "This site is below our paid tiers, so DO NOT offer money. Push for a free or editorial inclusion only." Otherwise → offer up to `<currency> <ceiling>` MAX, open around `<opening>`, move up in small steps, floor is `<floor>`, plus the aggressiveness line and `settings.anti_highball`.
- If `overLength`, adds instruction to wind down / propose a call rather than nagging.
- **Hard rules** injected: start with "Hi <first>,", end with "Best,\n<signer>", obey `settings.style_rules`, 2–5 sentences, never promise above ceiling or below floor.
- The full conversation is included, and the model must append a trailing `<<META offer=NUMBER_OR_none status=negotiating|agreed|declined|stalled>>` line.

Post-processing (`agent.ts:187-200`): if the LLM returns null → the function returns null (surfaced upstream as "No OPENROUTER_API_KEY configured"). It parses the META line to split off the body, extract `suggestedOffer` (unless "none"), and set `statusHint` (defaults to `negotiating`). It then **clamps `suggestedOffer` to [floor, ceiling]** in code even if the model drifts. The body is run through `sanitizeBody`. `shouldStop` is true when statusHint is `declined` or `agreed`.

---

### Pricing tiers by DR — `src/lib/negotiation/pricing.ts` and settings defaults

`maxOfferFor(dr, traffic, usShare, rules)` picks the **highest-paying** tier the domain qualifies for. A threshold is "met" if it is unset/≤0, **or the metric is null (unverified)**, **or the value ≥ the threshold** (`pricing.ts:14-15`). This unverified-passes rule matters because the free Ahrefs plan supplies DR only — so DR-based tiers apply now and traffic/US-share thresholds automatically tighten once a paid data source fills those fields. Returns `{ offer, rule }` for the best-matching tier, or **null** when no tier matches (below every tier's floor) → treated everywhere as "placement-only, no paid offer".

Default settings (`settings.ts:32-49`): `ai_autonomy:false`, aggressiveness `firm`, `opening_percent:20`, `max_thread_length:4`, `min_price:0`, currency `USD`, style rules forbid em/en dashes and bracketed placeholders, and a single default tier `{ min_dr:50, min_traffic:10000, min_us_share:50, max_offer:150 }`. `getNegotiationSettings()` reads the singleton row (`id = true`) and merges over the defaults; `parseRules` guards malformed JSON by falling back to the default tier list. When no settings row exists, the defaults are used as-is.

**Ceiling precedence** (consistent in `run.ts:49` and `threads/route.ts:35`): a per-thread `max_offer` (set via the Enable-AI dialog override or ai-manage) always wins over the computed tier; otherwise the tier offer; otherwise null/placement-only.

---

### autonomy (`ai_autonomy`) vs per-thread `ai_managed`

Two independent gates both matter:
- **`ai_managed`** (per outreach thread, boolean on the `outreach_emails` row): set true/false via `POST /api/emails/ai-manage`. Marks a thread as one the AI should handle. It is what makes a thread appear on the Negotiation page even before any reply (bucket **queued**), and it is the filter the batch auto-negotiation loop uses (`process/route.ts:157` selects `ai_managed = true`). Enabling AI on a thread does **not** by itself send anything.
- **`ai_autonomy`** (single global setting on `negotiation_settings`, edited on the Handbook page): when **false**, every generated reply is saved as a draft for human approval; when **true**, replies are sent automatically — but only for non-hard-no/non-unsubscribe intents, and (in the batch loop) only for `ai_managed` threads with a genuinely new unanswered reply.

So: manual "Draft AI reply" from the page works on any needs_reply/negotiating thread regardless of `ai_managed`, and honors `ai_autonomy` for whether it sends. Hands-off automation requires **both** `ai_managed = true` on the thread **and** `ai_autonomy = true` globally, driven by the batch processor.

---

### Flows

#### A) A reply arrives and becomes a negotiation
1. The batch processor (`POST /api/emails/process`) runs IMAP reply detection first (`process/route.ts:61-64`).
2. `detectReplies` matches inbound messages to sent emails. For a genuine reply, sentiment is analyzed and the reply is attributed to the **thread anchor** (the initial), never to a follow-up/negotiation child (`imap.ts:204-215`).
3. `recordReplyOnAnchor` stamps `replied_at`, `reply_kind`, `reply_from`, `reply_subject`, `reply_excerpt`, `reply_sentiment` on the anchor, and clears any `bounced_at`. It is **idempotent**: if the same excerpt is already recorded it returns false and does not bump `replied_at` (so a later sweep can't re-trigger negotiation) (`queries.ts:1583-1588`).
4. A new reply cancels any pending follow-up to that author (`imap.ts:218-221`). A bounce instead clears the reply mark, sets `bounced_at`, skips follow-ups, and discards the author (`imap.ts:223-233`).
5. The thread now surfaces on `GET /api/negotiation/threads` — bucketed as needs_reply (reply, not yet answered), automated (auto reply_kind), bounced, etc.

#### B) Manual draft & send (autonomy OFF)
1. User opens the Negotiation page → Needs reply tab, expands a thread, clicks **Draft AI reply** (or the row's **Draft AI reply** button).
2. `POST /api/negotiation/draft { emailId }` → `negotiateThread` classifies, drafts, deletes prior unsent drafts, inserts a `kind='negotiation'` draft (status `draft`), and updates the anchor's `negotiation_status`.
3. The editor opens with the draft. User optionally edits, clicks **Send reply** → `POST /api/negotiation/[id] { action:'send', body }` → `deliverOutreach` threads the reply via the parent Message-ID; on success the child flips to `sent`, moving the thread to the **Negotiating** bucket.
4. Alternatively **Discard** deletes the draft, or **Regenerate** re-runs the draft.

#### C) Hands-off automation (autonomy ON)
1. Threads are marked `ai_managed` (via Enable AI). `ai_autonomy` is ON in the Handbook.
2. On each `POST /api/emails/process` run, after sending due mail, the auto-negotiation loop (`process/route.ts:149-174`) selects up to 40 `ai_managed` initials with a non-null `replied_at`, skipping ones already `agreed`/`declined` and any thread containing an `auto` reply.
3. For each, it finds the latest reply timestamp and the latest sent negotiation answer; if the reply is already answered (`lastAnswer >= latestReply`) it's skipped. Otherwise it calls `negotiateThread(id)`.
4. Because `ai_autonomy` is true and the intent isn't hard-no/unsubscribe, the reply is drafted **and sent** immediately, threaded into the original. Counts roll up into the `negotiations: { sent, drafted }` result surfaced by "Process now".

#### D) Enabling AI on a selection with an override
1. Select threads → **Enable AI (N)** → toggle off "Use Handbook defaults" → set a max-offer override and/or criteria note → **Enable AI**.
2. `POST /api/emails/ai-manage { ids, managed:true, max_offer?, criteria? }` sets `ai_managed=true`, `max_offer` (per-thread ceiling), and `negotiation_notes` on each. Subsequent drafts use that ceiling in place of the DR tier.

#### E) Deal reached
When the agent returns `statusHint:"agreed"`, `run.ts` writes `negotiation_status:"agreed"`, `agreed_price`, and `payment_status:"owed"` (if a price) on the anchor. The thread moves to the **Agreed** bucket and appears in the Payments view (`getPaymentThreads`). `declined` → **Hard no** bucket.

---

### Key checks & validations

- **Ceiling/floor enforcement is defense-in-depth**: the prompt states the limits, and `draftNegotiationReply` additionally clamps `suggestedOffer` into `[floor, ceiling]` in code (`agent.ts:197-198`).
- **Hard-no / unsubscribe never auto-send**: enforced twice — the autonomy gate excludes those intents (`run.ts:60`), and the agent returns a fixed decline body with `shouldStop`/`declined` for them (`agent.ts:129-134`).
- **No em/en dashes**: enforced in code by `sanitizeBody` on every body (`agent.ts:24-34`), not just via the prompt.
- **Stale-draft cleanup**: prior unsent `negotiation` drafts are deleted before inserting a fresh one (`run.ts:69`).
- **Idempotent reply recording**: prevents re-triggering negotiation from repeat IMAP sweeps (`queries.ts:1586`).
- **Recipient resolution & guard**: `recipient_override` (test send) wins over the author `mailto`; sending with no recipient returns a 400 on the manual path and falls back to a saved draft (`recipientMissing`) on the autonomous path.
- **Unverified metrics don't disqualify tiers**: `maxOfferFor` treats null traffic/US-share as passing (`pricing.ts:15`).
- **Thread-length limit**: after `max_thread_length` of our messages, the prompt instructs the model to wind down rather than nag (`agent.ts:127`, `agent.ts:171`).
- **`send:false` semantics**: only the literal `false` forces draft-only; nothing else forces a send (autonomy decides) (`draft/route.ts:13`).

---

### Edge cases & cautions

- **No auth on most negotiation routes**: `/api/negotiation/threads`, `/api/negotiation/[id]`, `/api/negotiation/draft`, `/api/negotiation/settings`, and `/api/emails/ai-manage` have **no session check** in-handler (unlike `/api/emails/process`, which is gated by `CRON_SECRET`/session). Anyone who can reach these endpoints can list threads, draft, send, discard, retune the handbook, or flip `ai_managed`. A maintainer should confirm route protection lives elsewhere (middleware/proxy) before treating this as safe.
- **`applyAI` and `processNow` don't check the HTTP response**: `applyAI` (`page.tsx:116`) awaits the fetch but never inspects `res.ok`/JSON, so a server 400/500 (e.g. the "provide ids[] or all:true" error) still fires a success toast. Failures here are silent to the user.
- **No LLM key = degraded behavior, not an error toast on classify**: `classifyReplyIntent` silently falls back to keyword heuristics, but `draftNegotiationReply` returns null with no key, surfaced as `{ error: "No OPENROUTER_API_KEY configured" }`. The heuristic classifier can misread nuanced replies (e.g. a soft "we usually don't, but…" → `hard_no`), which — combined with autonomy — would auto-send the canned decline. Model classification defaults ambiguous intents to `interested`, which under autonomy will auto-send a negotiating reply.
- **Autonomy auto-send hinges on a correct `auto` classification**: only threads flagged `reply_kind === "auto"` (set at IMAP time) are skipped in the batch loop and bucketed as Automated. A vacation autoresponder misread as a `reply` could get an AI reply sent to a no-reply address.
- **Idempotency depends on the excerpt staying identical**: `recordReplyOnAnchor` compares trimmed `reply_excerpt`. If IMAP extracts a slightly different excerpt for the same message on a later sweep, `replied_at` gets bumped and (with autonomy) the thread can be answered again. Conversely, a genuine *new* reply that happens to share the previous excerpt text would be treated as already-seen.
- **`agreed_price` fallback can be null**: on agreement with no named/derived price, `agreed_price` is null and `payment_status` stays null even though `negotiation_status` is `agreed` (`run.ts:93`) — the Payments view then shows it as "owed" with no amount.
- **Signer name is hardcoded to "Abdullah"** when `senderName` isn't passed (`agent.ts:125`), and `negotiateThread` never passes `senderName` — so every AI reply signs off as Abdullah regardless of which mailbox (`sender_email`) actually sends it.
- **Bounced/agreed/declined precede replied in bucketing**: a thread that later bounces or reaches a terminal negotiation status will move out of needs_reply/negotiating even if a fresh human reply exists, because those checks come first (`threads/route.ts:41-45`).
- **`GET /threads` scans up to 1000 initials then filters in memory**: at higher volume, engaged threads beyond the 1000 most-recently-sent initials silently won't appear.
- **Draft actions target the latest child only**: `POST /api/negotiation/[id]` and the threads route both use the newest `kind='negotiation'` row. If multiple children somehow exist, older drafts are ignored (and the send route only acts on `draft`/`failed` status, so a `sent` latest child yields "No draft to act on" 404).
- **Test-send override propagates through the whole AI thread**: `recipient_override` copied onto each negotiation child (`run.ts:85`) keeps replies on the test address — but if it was set for testing and left on, real negotiation replies would go to the test inbox rather than the author.
- **Auto-negotiation is bounded per run** (40 initials scanned; the send loop and follow-ups also run in the same request under `maxDuration=300`). A large backlog is worked down across multiple process runs, not all at once.
- **The autonomy badge on the page is display-only**: users must go to the Handbook to actually change it; toggling expectations here is a common point of confusion.

---

## Inbox (Conversations)

### Purpose

The Inbox is GenAI Scout's unified conversation view: a two-pane email client that shows, per person (author/journalist/blogger), the full back-and-forth between one of the team's Gmail sending mailboxes and that recipient — read live over IMAP from Gmail's "All Mail" — and lets you reply into the same Gmail thread.

It is built on top of the outreach send history. Rows in `outreach_emails` (initial sends, follow-ups, negotiations, plus their reply/bounce/sentiment metadata computed by the reply-detection sweep) are grouped by author into "people". Each person is bucketed into a category (Responses / Awaiting / Filtered) and given per-user state (unread, dismissed). Selecting a person opens their real Gmail thread over IMAP; you can then reply, dismiss/restore them, jump to their prospect profile, and see AI-derived sentiment on genuine replies.

Key traits:
- **Read is live over IMAP** — the conversation is pulled from Gmail every time you open a thread; it is not stored in the app DB.
- **The list is derived from the DB**, not from IMAP — the left pane (categories, counts, previews, sentiment badges) comes from `outreach_emails` + `inbox_state`, so it renders instantly and does not require a mailbox connection.
- **Sentiment is precomputed** during reply detection (`runReplyDetection` in `src/lib/email/imap.ts`), stored on the anchor `outreach_emails` row (`reply_sentiment`), and merely displayed here — the inbox pages do not call the LLM themselves.
- **An account switcher** lets any signed-in team member view (and act in) any configured team mailbox.

Primary source files:
- Page (client): `src/app/inbox/page.tsx`
- List API: `src/app/api/inbox/route.ts`
- Thread API: `src/app/api/inbox/[id]/route.ts`
- Reply API: `src/app/api/inbox/[id]/reply/route.ts`
- Dismiss API: `src/app/api/inbox/[id]/dismiss/route.ts`
- IMAP conversation reader + sentiment: `src/lib/email/inbox.ts`
- Shared IMAP classification/helpers: `src/lib/email/imap.ts`
- DB queries: `src/lib/db/queries.ts` (`getInboxList`, `getInboxTarget`, `getInboxAccounts`, `resolveInboxAccount`, `markInboxSeen`, `setInboxDismissed`, `getSharedSenders`, `getUserAppPasswordEnc`, `getUserEmailConfig`)
- SMTP sender: `src/lib/email/smtp.ts` (`sendEmailAs`)
- Secret crypto: `src/lib/crypto.ts` (`decryptSecret`)

---

### UI walkthrough

The page (`src/app/inbox/page.tsx`) is a full-height two-column layout (`-m-6 flex h-[calc(100vh-64px)]`). Left = people list (fixed `w-80`), right = the selected conversation.

#### Left pane — people list

**Header** (`inbox/page.tsx:176-180`)
- Violet `Inbox` icon + "Inbox" title.
- **Refresh button** (top-right, `RefreshCw` icon) → calls `loadList()`, re-fetching `/api/inbox`. The icon spins while `loading` is true.

**Account switcher** (`inbox/page.tsx:181-195`) — *rendered only when `accounts.length > 1`.*
- A native `<select>` listing every configured team mailbox (from `d.accounts`).
- The currently signed-in user's own mailbox is labeled `"{label} (you)"`; other mailboxes are labeled `"{label} — {email}"`.
- `value` is `viewAs || me` (defaults to your own address).
- On change: if you pick your own address, `viewAs` is reset to `""` (own inbox); otherwise `viewAs` is set to the chosen email. This drives the `?as=` query param (`asQ = viewAs ? '?as=<viewAs>' : ''`) appended to *every* inbox fetch.
- When viewing someone else's mailbox, a small amber caption appears: `"Viewing {viewAs} as admin"` (`inbox/page.tsx:193`).
- Changing the account triggers `loadList()` via the `useEffect` dependency on `loadList` (which depends on `asQ`), and clears the current selection.

**Search box** (`inbox/page.tsx:196-199`)
- `Search`-icon input, placeholder "Search people…". Filters the list **client-side** by case-insensitive substring match against the person's `name`, `publication`, or `recipient` (email). Does not hit the server.

**Category tabs** (`inbox/page.tsx:200-206`) — `TABS` constant (`inbox/page.tsx:26-32`):
| Tab key | Label shown | Meaning |
|---|---|---|
| `unread` | **Unread** | Replied threads with a reply this user hasn't opened yet |
| `replied` | **Responses** | People who sent a genuine reply |
| `sent` | **Awaiting** | We emailed them; no reply/bounce yet |
| `filtered` | **Filtered** | Bounced or auto-reply only |
| `dismissed` | **Dismissed** | People this user pushed aside |

- Each tab shows a count badge (`counts[t.key] ?? 0`), computed server-side (see List API). The active tab is highlighted violet.
- Clicking a tab sets `tab` and re-filters the already-loaded people client-side (no refetch).

**Sort + filter toolbar** (`inbox/page.tsx:208-223`)
- **Sort `<select>`** (`sortBy`): `recent` (Newest, default), `oldest`, `unread` (Unread first), `name` (Name A–Z), `sentiment`. Sorting is client-side (`inbox/page.tsx:164-170`):
  - `recent`/`oldest`: by `dateOf(p)` = `last_at ?? replied_at ?? success_at ?? 0`.
  - `unread`: unread people first, then most-recent.
  - `name`: alphabetical by name.
  - `sentiment`: positive → neutral → negative → none (`sentRank`), tie-broken by most-recent.
- **Sentiment filter buttons** (`sentFilter`): `All`, positive (`Smile`), neutral (`Meh`), negative (`Frown`). Filters the list to people whose `reply_sentiment` matches (client-side). Active button is color-highlighted.
- **Wins-only toggle** (`Trophy` button, `wonOnly`): when on, shows only people with a `success_at` (a recorded "win"). Toggles on/off.

**List body** (`inbox/page.tsx:224-253`)
- While `loading`: shows `ListSkeleton` (8 shimmering placeholder rows).
- If the filtered list is empty: a context-specific empty-state message per tab (`inbox/page.tsx:226-228`):
  - unread → "No unread replies. 🎉"
  - dismissed → "Nothing dismissed."
  - filtered → "No bounces or auto-replies."
  - sent → "Nobody awaiting a reply."
  - else (replied) → "No responses yet."
- Each **person row** shows:
  - **Avatar** (`avatar_url`, else initials from the first 2 letters of name). A violet dot badge overlays the avatar when `unread`.
  - **Name** (bold if unread, medium otherwise) + a small right-aligned timestamp (`timeLabel(last_at)`, formatted `MMM D, hh:mm AM/PM`).
  - **Preview line**: `reply_excerpt || publication || recipient`.
  - **Badge row**: a `Trophy` if `success_at`; a `Sentiment` badge (only when `category === "replied"`); a red "bounced" badge (with `Ban` icon) if `bounced_at`; an "auto-reply" badge if `reply_kind === "auto"` and not bounced.
  - **Dismiss/restore button** (right edge, appears on hover): `Archive` icon ("Dismiss (push aside)") on active rows, `ArchiveRestore` ("Restore") on dismissed rows. Clicking calls `dismiss(p, !p.dismissed, e)` and `stopPropagation()`s so the row isn't also selected.
- Clicking anywhere else on a row calls `selectPerson(p)`.

The `Sentiment` component (`inbox/page.tsx:39-44`) renders a tiny bordered pill: emerald "positive" (`Smile`), red "negative" (`Frown`), amber "neutral" (`Meh`); renders nothing for any other value (including `null`).

#### Right pane — conversation

**Empty state** (`inbox/page.tsx:258-261`): when no person is selected — a faint `Inbox` icon and "Pick a person to see the full conversation and reply."

**Conversation header** (`inbox/page.tsx:264-276`)
- Avatar + the person's **name as a button** → `openAuthor(author_id)` opens the shared prospect drawer (`useAuthorDrawer`, which fetches `/api/authors/[id]` and renders `ProspectDrawer`).
- Sub-line: `recipient` email, and if `account` is known, `" · via {sender_label ?? account}"` (which mailbox the thread is in).
- Right-side actions:
  - A `Sentiment` badge (only when `category === "replied"`).
  - **View profile** button → `openAuthor(author_id)` (same drawer).
  - **Dismiss / Restore** button (`Archive`/`ArchiveRestore`) → `dismiss(selected, !selected.dismissed)`.
  - **Refresh** button (`RefreshCw`) → `loadThread(selected)`; spins while `threadLoading`.

**Message list** (`inbox/page.tsx:278-317`)
- While `threadLoading`: `ThreadSkeleton` (3 alternating bubbles).
- If there's a `threadErr` and no messages: an amber warning box (`AlertTriangle` + the error text). This is how mailbox-credential and IMAP errors surface (see Thread API — those return HTTP 200 with an `error` field).
- If no error but zero messages: "No messages found in the mailbox for this person."
- Otherwise each message renders as a chat bubble:
  - **Outbound** (`direction === "outbound"`, i.e. from us): right-aligned, violet bubble, sender label "You".
  - **Inbound bounce** (`kind === "bounce"`): left-aligned, red-tinted bubble, a red "bounce" badge (`Ban`).
  - **Inbound auto-reply** (`kind === "auto"`): left-aligned, muted bubble, "auto-reply" label.
  - **Inbound normal reply**: left-aligned muted bubble; sender label is `fromName || from`.
  - Header row of each bubble: sender, kind badges, a `Paperclip` if `hasAttachments`, and right-aligned `timeLabel(date)`.
  - Body: `whitespace-pre-wrap`, wrapped; if the body is empty, shows italic "(no text)".
  - **Images**: any `images[]` (remote `<img>` URLs from HTML + inline image attachments as data URLs) render as thumbnails (`max-h-40`), each a link opening the full image in a new tab.
  - **Non-image attachments**: rendered as `Paperclip` chips showing the filename (images are excluded here since they render as thumbnails).
- A `threadEndRef` sentinel div at the bottom is used for auto-scroll.

**Reply composer** (`inbox/page.tsx:319-337`)
- **Pending attachment tray** (shown when `attachments.length > 0`): image attachments as 56×56 thumbnails, non-images as a filename tile; each has a hover "X" to remove it from the pending list.
- **Attach button** (`Paperclip`) → opens a hidden `<input type="file" accept="image/*" multiple>`. `onFiles` (`inbox/page.tsx:121-131`) takes up to **10** files, skips any file **over 8 MB** (toast "over 8MB — skipped"), and reads each as a base64 data URL via `FileReader`. (Note: `accept="image/*"` limits the picker to images even though the backend accepts any content type.)
- **Textarea**: placeholder "Reply to {name}…", auto-height (min 44px, max 40 = `max-h-40`). Pressing **⌘/Ctrl+Enter** submits (`sendReply`).
- **Send button**: disabled while `sending` or when the trimmed reply is empty. Shows a spinner while sending.
- Helper caption: "Replies thread into the Gmail conversation · ⌘/Ctrl+Enter to send".

At the bottom, `{drawer}` renders the prospect side panel from `useAuthorDrawer`.

#### Client-side interaction behaviors

- **`selectPerson(p)`** (`inbox/page.tsx:108-111`): sets the selected person, clears reply text + pending attachments, calls `loadThread(p)`, and **optimistically clears unread** — flips `p.unread` to false in local state and decrements the `unread` count locally (the server clears it too via `markInboxSeen`, triggered by the thread fetch).
- **`loadThread(p)`** (`inbox/page.tsx:97-106`): fetches `/api/inbox/{author_id}{asQ}`, sets `messages` and `account` (from `target.account`), records any `error` into `threadErr`, and smooth-scrolls to the bottom after 100ms.
- **`dismiss(p, dismissed)`** (`inbox/page.tsx:113-119`): optimistically flips `dismissed` and adjusts the `dismissed` count locally, POSTs to the dismiss route (errors swallowed with `.catch(() => {})`), then toasts "moved to Dismissed" / "restored".
- **`sendReply()`** (`inbox/page.tsx:133-154`): see Flows below.

---

### API routes / server logic

All four routes require a signed-in session (`auth()` from `@auth`) and 401 `{ error: "not signed in" }` if `session.user.email` is missing. `auth()` is wrapped in `.catch(() => null)` so an auth failure degrades to 401 rather than throwing.

Every route resolves the target mailbox through **`resolveInboxAccount(me, as)`** (`queries.ts:2101-2105`):
- If `as` is absent or equals `me` (case-insensitive) → returns `me` (own mailbox).
- Otherwise it looks up `getInboxAccounts()` (all mailboxes that have an app password on file) and returns `as` **only if it is one of them**; otherwise silently falls back to `me`.
- **There is no admin-role gate** — any signed-in team member may pass `?as=<any configured mailbox>` and read/reply/dismiss in it. The "admin" framing is UI language only.

#### `GET /api/inbox` — the people list

File: `src/app/api/inbox/route.ts`.

- **Query param**: `as` (optional) — mailbox to view.
- **Auth**: signed-in required (401 otherwise).
- **Logic** (`route.ts:12-25`):
  1. `viewing = resolveInboxAccount(me, as)`.
  2. In parallel: `getInboxList(viewing)`, `getSharedSenders()`, `getInboxAccounts()`.
  3. Build a `email → shared_sender_label` map and attach `sender_label` to each person (label of the mailbox that holds their thread; `null` if the sender isn't a shared-labeled account or `sender_email` is null).
  4. Split into `active` (non-dismissed) and compute **counts** from `active`: `unread` (active & unread), `replied`, `sent`, `filtered` (by category), and `dismissed` (from the *full* enriched list, i.e. everyone dismissed).
- **Response (200)**: `{ people: enriched, counts, accounts, viewing, me }`.
  - `people` includes dismissed people too (the client filters them into the Dismissed tab). `counts` gates what's shown in each tab badge.
  - `accounts` populates the switcher; `me` identifies the signed-in user; `viewing` is which mailbox was resolved (currently unused by the client UI).
- **Error branches**: only 401 (not signed in). Supabase read failures inside `getInboxList` are not explicitly caught here — an unhandled DB error would surface as a 500 (the client's `loadList` wraps the fetch in try/catch and leaves the list empty on any failure).

**`getInboxList(userEmail)`** (`queries.ts:2340-2389`), the heart of the list:
- Selects from `outreach_emails` joined to `authors` (name, avatar, domain, contacts) where `status = 'sent'` **OR** `replied_at is not null` **OR** `bounced_at is not null`.
- **Mailbox scoping**: if `userEmail` is the env owner (`SMTP_USER`), matches `sender_email = userEmail OR sender_email IS NULL` (legacy env-sender sends belong to the SMTP_USER account); otherwise strictly `sender_email = userEmail`.
- Ordered by `sent_at` desc, capped at **3000** rows.
- **Groups by `author_id`**, picking one representative row per author by rank: replied (3) > bounced/auto (2) > sent (1), tie-broken by latest `sent_at` (`queries.ts:2352-2356`). So each person shows the most-engaged state.
- Loads per-user `inbox_state` (`last_seen_at`, `dismissed`) for those authors.
- Derives per person:
  - `recipient` = the author's first `mailto` contact (`mailto:` prefix stripped). **Authors with no mailto contact are dropped entirely** (`if (!recipient) continue;`).
  - `category`: `replied_at` → `"replied"`; else `bounced_at || reply_kind === "auto"` → `"filtered"`; else `"sent"`.
  - `unread`: `replied_at` present **and** (`last_seen_at` missing **or** `replied_at > last_seen_at`). Only replied threads can be unread.
  - `last_at` = `replied_at ?? bounced_at ?? sent_at`.
- Sorted by `last_at` desc.

#### `GET /api/inbox/[id]` — live IMAP thread

File: `src/app/api/inbox/[id]/route.ts`. `maxDuration = 60` (seconds) — allows a slow IMAP read.

- **Path param**: `id` = `author_id`.
- **Query param**: `as` (optional).
- **Auth**: 401 if not signed in.
- **Logic** (`route.ts:11-33`):
  1. `account = resolveInboxAccount(me, as)`.
  2. `target = getInboxTarget(id, account)`.
     - **404** `{ error: "No conversation with this person in this mailbox." }` if `target` is null — i.e. this mailbox never emailed this author, or the author has no mailto contact.
  3. `markInboxSeen(account, id)` — fire-and-forget (`.catch(() => {})`); opening the thread clears unread for the viewing account. **This runs before the IMAP read**, so even a subsequent IMAP failure still marks the thread seen.
  4. Resolve the mailbox password: `decryptSecret(getUserAppPasswordEnc(account))`, falling back to `process.env.SMTP_PASS` **only if** `account === SMTP_USER` (`isEnvOwner`).
  5. If no `account` or no `pass`: returns **HTTP 200** with `{ error: "No mailbox credentials on file for {account}. Add a Gmail app password in Settings to read this inbox.", target, messages: [] }`. (Not a 4xx — surfaced as the amber banner.)
  6. Otherwise `fetchConversation(account, pass, target.recipient)` and return `{ target: { ...target, account }, messages }` (200).
  7. On any thrown IMAP error: **HTTP 200** with `{ error: "Couldn't read the mailbox: {message}", target: {...target, account}, messages: [] }`.
- **Design note**: this route almost always returns 200 (except the 401 and the 404-no-target). Failures are conveyed via the `error` field with `messages: []`, which is why the client treats `threadErr && messages.length === 0` as the error state.

**`getInboxTarget(authorId, userEmail)`** (`queries.ts:2410-2433`):
- Selects the author's `outreach_emails` for this mailbox (same env-owner scoping as the list), ordered by `sent_at` desc, limit 20.
- Returns null if there are no rows (this mailbox never emailed this author) or if the author has no mailto contact.
- Returns `{ recipient, senderEmail: userEmail, name, publication, lastMessageId (first row that has a message_id), lastSubject (most recent row's subject) }`.

#### `POST /api/inbox/[id]/reply` — send a threaded reply

File: `src/app/api/inbox/[id]/reply/route.ts`. `maxDuration = 60`.

- **Path param**: `id` = `author_id`.
- **Query param**: `as` (optional) — reply is sent *from* the viewed mailbox.
- **Body** (`route.ts:13-18`): `{ body: string, to?: string, subject?: string, inReplyTo?: string, attachments?: {filename, content, contentType}[] }`. Missing/invalid JSON degrades to `{}`.
- **Validation order**:
  1. **400** `{ error: "Message body is required." }` if the trimmed `body` (`text`) is empty (checked *before* auth).
  2. **401** if not signed in.
  3. `account = resolveInboxAccount(me, as)`.
  4. `target = getInboxTarget(id, account)`; **404** `{ error: "No conversation with this person in this mailbox." }` if null.
- **Recipient**: `to` from the body if provided, else `target.recipient`. (The client never sends `to`, so it defaults to the person's address.)
- **Subject** (`route.ts:29`): `subject` from body if provided; otherwise `target.lastSubject` if it already begins with `re:` (case-insensitive), else `Re: {lastSubject || "our conversation"}`.
- **Attachments normalization** (`route.ts:32-38`): first 10 of `body.attachments`; each `content` is parsed as a `data:<type>;base64,<data>` URL (extracting the base64 payload and content type), or a bare base64 string (stripping any `data:...base64,` prefix); `encoding: "base64"`; entries with empty content are filtered out.
- **Password** (`route.ts:45`): `decryptSecret(getUserAppPasswordEnc(account))`, falling back to `SMTP_PASS` only if `isEnvOwner`. If none → **400** `{ error: "No Gmail app password on file for {account}. Add it in Settings to reply from this mailbox." }`.
- **Threading** (`route.ts:42`): `inReplyTo` is wrapped in `<…>` if not already, and used for **both** `inReplyTo` and `references` headers so Gmail nests the reply.
- **Send** (`route.ts:47-50`): `getUserEmailConfig(account)` for the `from_name`, then `sendEmailAs({ user: account, pass, fromName, to: recipient, subject, body: text, inReplyTo, references, attachments })` (Gmail SMTP, `smtp.gmail.com:465`).
  - On `res.ok === false` → **500** `{ error: res.error ?? "Send failed" }`.
  - On success → **200** `{ ok: true, messageId, from: account, to: recipient, subject }`.
- **Catch-all**: **500** `{ error: message ?? "Send failed" }`.

`sendEmailAs` (`smtp.ts:78-92`) builds a nodemailer transport per call, sets `from` to `"{fromName}" <{user}>` (or bare `user`), sends both `text` and an HTML-ified body (`htmlify`), then closes the transport.

#### `POST /api/inbox/[id]/dismiss` — push aside / restore

File: `src/app/api/inbox/[id]/dismiss/route.ts`.

- **Path param**: `id` = `author_id`. **Query param**: `as` (optional). **Body**: `{ dismissed: boolean }` (missing/invalid JSON → `{}`, so `dismissed` becomes `undefined` → coerced to `false`).
- **Auth**: 401 if not signed in.
- **Logic**: `account = resolveInboxAccount(me, as)`; `setInboxDismissed(account, id, !!dismissed)`; returns **200** `{ ok: true }`.
- No validation of `id` existence; `setInboxDismissed` upserts an `inbox_state` row unconditionally.

**`markInboxSeen`** (`queries.ts:2392-2397`) and **`setInboxDismissed`** (`queries.ts:2400-2405`) both upsert into `inbox_state` on `(user_email, author_id)`, setting `last_seen_at` and `dismissed` respectively (each sets only its own columns + `updated_at`, so they don't clobber each other's field). The `user_email` here is the **viewing account**, not necessarily the signed-in user.

---

### The IMAP conversation reader (`fetchConversation`)

`src/lib/email/inbox.ts:87-163`. Read-only. Steps:

1. **Connect**: `ImapFlow` to `imap.gmail.com:993` (TLS) with `user = account`, `pass`. Timeouts: `socketTimeout 60s`, `greetingTimeout 20s`. An `error` handler is attached (`client.on("error", () => {})`) because an unhandled imapflow socket `error` event would otherwise crash the whole Node process — awaited ops still reject and are caught.
2. **Mailbox**: locks `"[Gmail]/All Mail"` (so both sent and received messages appear in one place); if that fails, falls back to `"INBOX"`.
3. **Search** (`inbox.ts:107`): `since = now − days` (default `days = 365`), and `or: [{ from: recipient }, { to: recipient }]` — every message to *or* from this person in the window. If zero UIDs, returns empty. If more than `max` (default **60**), keeps the **last** 60 (`uids.slice(-max)`).
4. **Pass 1 — metadata only** (`inbox.ts:114-131`): fetches envelope + bodyStructure + selected headers for the UIDs. Per message:
   - Extracts `from` (lowercased first address) and `to` addresses.
   - **Filters out** any message that doesn't actually involve the recipient (`fromAddr === rcpt || toAddrs.includes(rcpt)`) — guards against Gmail search fuzziness.
   - **Direction**: `fromAddr === account` → `"outbound"`, else `"inbound"`.
   - **Kind**: for inbound only, `classify(fromAddr, subject, headers)` → `reply | bounce | auto` (shared with reply detection). Outbound is `null`.
   - Records `messageId` (normalized, `<>` stripped), `hasAttachments`, and the bodyStructure.
   - **Why two passes**: issuing a `download()` mid-`fetch` on the same IMAP connection deadlocks → socket timeout. So metadata is fully drained first, bodies downloaded after (`inbox.ts:111-113`).
5. **Pass 2 — bodies + rich content** (`inbox.ts:135-154`):
   - `bodyText(...)` downloads the best text part (prefer text/plain, else HTML) via `findTextPart`, caps the stream at 120 KB, strips HTML/entities and truncates to 6000 chars (`clean`).
   - **Rich content only for the most recent 14 messages** (`RICH_FROM = metas.length − 14`) to bound work:
     - Remote `<img>` URLs are extracted from the HTML part (`extractImgUrls`, up to 8, http(s) only).
     - Inline image attachments are downloaded as base64 data URLs, but only while a **global budget of 12** remains and each image is `> 0` and `< 2.5 MB`.
   - All non-text leaf parts are listed as `attachments` (filename + contentType).
   - `images` is de-duplicated and capped at 12 per message.
6. **Logout**, sort by `date` ascending, return.
7. On any error mid-read: `client.close()` (ignore failures) and rethrow — the route catches it and returns the "Couldn't read the mailbox" error.

**`classify`** (`imap.ts:33-47`) determines inbound kind from From/subject/headers:
- **bounce**: mailer-daemon/postmaster From; subject phrases like "delivery status notification", "undeliverable", "address not found", "failure notice"; header markers like `x-failed-recipients:`, `content-type: multipart/report`, `report-type=delivery-status`, `status: 5.x.x`.
- **auto**: headers like `auto-submitted: auto-*`, `x-autoreply:`, `precedence: auto_reply|bulk|junk`; subjects like "out of office", "automatic reply", "on vacation", "maternity/parental leave".
- else **reply**.

**Sentiment** — `analyzeSentiment(text)` (`inbox.ts:166-189`) is defined here but **called from reply detection** (`runReplyDetection`), not from any inbox route. It POSTs to OpenRouter (`anthropic/claude-haiku-4-5`, `max_tokens: 4`, `temperature: 0`, 15 s timeout) asking for exactly one word (positive/neutral/negative). Returns null if `OPENROUTER_API_KEY` is missing/short, text is empty, the call fails, or the output doesn't contain a known word. The result is stored on the anchor row's `reply_sentiment` and merely displayed in the inbox.

---

### Direction and how threads are read (inbound vs outbound)

- The thread is read from the **sending mailbox's** "All Mail", which contains both what we sent and what came back. Each message's `direction` is decided purely by comparing the From address to the mailbox account: from us → **outbound** (violet, "You"); from anyone else → **inbound**.
- Inbound messages are further classified (`reply`/`bounce`/`auto`) for styling and badges.
- The *list* categories (`replied`/`filtered`/`sent`) come from the DB fields (`replied_at`, `bounced_at`, `reply_kind`) that the reply-detection sweep wrote — independent of the live thread read. The list and the thread can therefore momentarily disagree (e.g. a brand-new reply not yet swept won't have moved the person to "Responses", but opening the thread will show the message).

---

### Key checks & validations

- **Auth**: all four routes require a signed-in session (401 otherwise).
- **Mailbox resolution** (`resolveInboxAccount`): `?as=` is honored only if it matches a mailbox that has an app password on file; otherwise silently falls back to the caller's own address. No admin-role check.
- **Target scoping** (`getInboxTarget`): a thread/reply is only allowed if the resolved mailbox actually has `outreach_emails` rows for that author. Otherwise 404. Recipient must have a `mailto` contact.
- **Env-owner special case**: when the mailbox equals `SMTP_USER`, list/target queries also include legacy `sender_email IS NULL` rows, and the password can fall back to `SMTP_PASS`.
- **Password required to read/reply**: no decryptable app password (and not env-owner) → thread returns 200-with-error; reply returns 400.
- **Reply body required**: empty trimmed body → 400 (checked before auth).
- **Attachment limits**: server caps at 10 attachments and filters empties; client caps at 10 files, skips files > 8 MB, and (via `accept="image/*"`) only offers images in the picker.
- **Recipient-involvement guard** in `fetchConversation` drops search hits that don't actually involve the recipient address.
- **Unread** is only ever true for replied threads whose `replied_at` post-dates the user's `last_seen_at`.

---

### Flows

#### Opening the inbox
1. Page mounts → `useEffect` runs `loadList()` and clears selection.
2. `loadList()` GETs `/api/inbox{?as=…}` → server resolves the mailbox, builds the grouped people list, per-tab counts, account list, and `me`.
3. The client stores `people`, `counts`, `accounts`, `me`. The list renders per the active tab + search + sort + sentiment/won filters (all client-side).

#### Switching to another team member's inbox
1. Switcher shows only if `accounts.length > 1`.
2. Selecting an account sets `viewAs` → `asQ` changes → `loadList` is re-created → `useEffect` refetches `/api/inbox?as=<email>` and clears selection.
3. Amber "Viewing … as admin" caption appears. All subsequent thread/reply/dismiss/seen calls carry the same `?as=`, so they act in that mailbox.

#### Reading a conversation
1. Click a person → `selectPerson`: sets `selected`, resets composer, optimistically clears unread locally, calls `loadThread`.
2. `loadThread` GETs `/api/inbox/{author_id}{?as=…}`.
3. Server: resolve mailbox → `getInboxTarget` (404 if none) → `markInboxSeen` (clears unread server-side) → resolve password → `fetchConversation` over IMAP.
4. Client renders bubbles; if `error` + no messages, shows the amber banner; auto-scrolls to bottom.

#### Sending a reply
1. Type a reply (and optionally attach images). Press Send or ⌘/Ctrl+Enter → `sendReply` (`inbox/page.tsx:133-154`).
2. Client finds the last message that has a `messageId` (searching from the end) to use as `inReplyTo`, then POSTs `/api/inbox/{author_id}/reply{?as=…}` with `{ body, inReplyTo, attachments }`.
3. Server validates body → auth → resolve mailbox → `getInboxTarget` → normalize attachments → resolve password → derive subject/recipient → `sendEmailAs` with `In-Reply-To`/`References` headers.
4. On `{ ok: true }`: client toasts success, **optimistically appends** an outbound bubble (with a negative temp `uid`, "You", image previews from the pending attachments), clears the composer, scrolls down, and **schedules a full `loadThread` reload after 7 seconds** to replace the optimistic bubble with the real IMAP-read message.
5. On failure: toast with the server error (or "Couldn't send reply.").

#### Dismiss / restore
1. Click the row's archive icon (or the header Dismiss/Restore button) → `dismiss(p, !p.dismissed)`.
2. Client optimistically flips `dismissed`, adjusts the `dismissed` count, POSTs `/api/inbox/{author_id}/dismiss{?as=…}` with `{ dismissed }`, and toasts.
3. Server upserts `inbox_state.dismissed` for the viewing account. Dismissed people leave the main tabs and appear under Dismissed (client-side `inTab` logic, `inbox/page.tsx:156`).

---

### Edge cases & cautions

- **The "own inbox only" privacy boundary is no longer enforced.** The code comments on `InboxPerson`/`getInboxTarget`/`getInboxList` (`queries.ts:2337-2339`, `2407-2409`) say a user "only ever sees/reads their own inbox," but the `?as=` switcher (via `resolveInboxAccount`) lets **any signed-in team member view, read, reply-from, and dismiss-in any configured team mailbox** — there is no admin/role gate. The UI only hides the switcher when there's a single account, but the API accepts `?as=` regardless of the caller. Maintainers relying on those comments as a security guarantee should be aware they are stale.
- **Acting as another mailbox writes that mailbox's per-user state.** `markInboxSeen`/`setInboxDismissed` are keyed by the *viewing* account. So opening or dismissing a thread while "viewing as" someone clears/sets **their** unread/dismiss state (and replies are sent from their address), not the actor's. There's no separate audit of who did it.
- **Marking-seen happens before the read.** `markInboxSeen` runs (fire-and-forget) even if the IMAP read then fails, so a thread that failed to load is still counted as "seen" and drops out of Unread on next list load.
- **Thread errors return HTTP 200.** Credential-missing and IMAP failures come back as 200 with an `error` field and `messages: []`. Any caller/monitor checking only HTTP status will think the read succeeded. The client relies on `threadErr && messages.length === 0`.
- **Optimistic reply bubble can diverge from reality.** After a successful send the UI shows a synthetic bubble immediately and only reconciles ~7 s later via a full re-read. If that re-read fails (IMAP hiccup) the optimistic bubble persists but the thread state (error banner) may replace the whole message list — the appended bubble is lost on the next successful reload, and the real threaded message only appears once Gmail/IMAP catches up.
- **Sentiment is not live.** It's computed only during `runReplyDetection` and stored; the inbox never recomputes it. If OpenRouter was unavailable or the reply hadn't been swept, `reply_sentiment` is null and no badge shows even for a genuine reply. It also only exists for `category === "replied"`.
- **Rich content is bounded and lossy.** Only the last 14 messages get images; inline images share a global budget of 12 and skip anything ≥ 2.5 MB; remote `<img>` URLs are capped at 8 and `images` at 12 per message. Older messages in a long thread won't show inline images, and body text is truncated to 6000 chars.
- **60-message / 365-day window.** `fetchConversation` only looks back a year and keeps at most the newest 60 matching messages; very long or old conversations are truncated (oldest dropped).
- **Recipient must have a mailto contact.** Authors without a `mailto` contact are silently dropped from the list and yield a 404 target — you can't view/reply to them here even if `outreach_emails` rows exist.
- **List cap of 3000 rows.** `getInboxList` reads at most 3000 `outreach_emails` rows (newest first) before grouping; in a very high-volume account, the oldest people could fall out of the list.
- **Counts vs. client filters.** Tab count badges are computed server-side over *all* people in that category; the visible list is additionally narrowed by the client-side search/sentiment/won filters. So the badge number can exceed the number of rows actually shown.
- **Env-owner scoping quirk.** Legacy sends with `sender_email = null` are attributed to the `SMTP_USER` mailbox. If `SMTP_USER` isn't configured, those legacy rows belong to no mailbox and won't appear for anyone.
- **Password fallback only for env owner.** Only the `SMTP_USER` account can fall back to `SMTP_PASS`; every other mailbox must have an encrypted `app_password_enc` in `user_email_config`, or reads/replies fail (with the "Add a Gmail app password in Settings" message).
- **Secret decryption is silent-fail.** `decryptSecret` returns `null` on any error (bad format, wrong `AUTH_SECRET`, tampering) rather than throwing — so a corrupted/rotated key manifests as "No mailbox credentials on file," not an obvious crypto error. Note the encryption key is derived from `AUTH_SECRET`; rotating `AUTH_SECRET` invalidates all stored app passwords.
- **Reply threading depends on a stored `message_id`.** The client's `inReplyTo` is the newest message in the *live thread* that has a `messageId`; if none of the read messages expose a Message-ID, the reply is sent with no threading headers and Gmail may start a new thread. (Subject-based "Re:" still helps Gmail group it.)
- **Dismiss errors are swallowed client-side.** `dismiss(...)`'s fetch is `.catch(() => {})`, so a failed server dismiss still shows the optimistic UI + success toast; the change is lost on the next `loadList`.
- **No CSRF/state token on the mutating routes.** Reply and dismiss are plain POSTs protected only by the session cookie.

---

## Payments

### Purpose

The Payments area is the money-tracking ledger for deals the AI negotiator closed. When an AI-managed negotiation reaches an "agreed" outcome with a price, that thread becomes a **payment owed**. This area lets an operator:

- See every deal that closed as a paid placement (agreed, with an amount owed) plus anything that already has a payment status.
- Read the full back-and-forth conversation for each deal before paying, and see which sending inbox the deal lives under.
- Mark a deal **paid**, **email the owning account a request to process payment**, or **reset a paid/requested deal back to owed** (undo).
- See running totals of money owed vs. money paid.

It is a lightweight internal bookkeeping layer on top of the `outreach_emails` table — there is **no real payment processor, no invoicing, and no money movement**. "Marking paid" only writes status columns; the actual payment happens outside the app (e.g. bank transfer / PayPal), and a human records it here.

Key source files:
- Page/UI: `src/app/payments/page.tsx`
- List API: `src/app/api/payments/route.ts` (GET)
- Per-thread API: `src/app/api/payments/[id]/route.ts` (GET conversation, POST action)
- Data layer: `src/lib/db/queries.ts` — `getPaymentThreads` (line ~2014), `markPayment` (~2037), `getConversation` (~1993), `PaymentThread` interface (~2007)
- Deal creation: `src/lib/negotiation/run.ts` (line ~89–94) — where "agreed" turns into `payment_status: "owed"`
- Email delivery: `src/lib/email/deliver.ts` — `deliverOutreach`
- Nav entry: `src/components/layout/Sidebar.tsx` line 39 (`{ name: "Payments", href: "/payments", icon: CreditCard }`)

---

### Data model (what a payment "is")

A payment record is **not** a separate table row — it is the **initial outreach email row** (`outreach_emails` where `kind = "initial"`) reused as the deal anchor. The relevant columns:

| Column | Meaning |
|---|---|
| `negotiation_status` | Set by the negotiation engine; `"agreed"` means a deal closed. |
| `agreed_price` | The price the AI agreed to. Set at agreement time. This is the amount **owed**. |
| `payment_status` | The payment lifecycle state: `"owed"`, `"requested"`, `"paid"`, or `null`. |
| `payment_requested_at` | Timestamp stamped when a payment request email is sent. |
| `paid_amount` | Amount recorded as paid — snapshotted from `agreed_price` when marked paid. |
| `paid_at` | Timestamp when marked paid; cleared on reset. |
| `sender_email` | The inbox the thread lives **under** (the owning sending account). Used as the payer for "Email to pay". |
| `sent_by_email` | Who actually triggered the send (shared-inbox case; may differ from `sender_email`). |
| `author` → `authors(full_name, domain:domains(host, name, dr))` | Writer + publication + Domain Rating, joined for display. |

The `PaymentThread` interface returned to the client (`queries.ts` ~2007):
```
id, name, publication, host, dr, sender, sentBy,
agreedPrice, paidAmount, status, paidAt, requestedAt, subject
```

**How a negotiation "agreed" creates a payment owed** (`src/lib/negotiation/run.ts` ~89–94): after the AI drafts a reply whose `statusHint === "agreed"`, the code computes:
```js
const agreedPrice = draft.statusHint === "agreed"
  ? (draft.suggestedOffer ?? cls.priceMentioned ?? null) : null;
```
then updates the **initial** email row with `negotiation_status: "agreed"` and, only if agreed:
```js
...(draft.statusHint === "agreed"
  ? { agreed_price: agreedPrice, payment_status: agreedPrice ? "owed" : null }
  : {})
```
So: a deal that agrees **with** a price gets `agreed_price` set and `payment_status = "owed"`. A deal that agrees at **zero/placement-only** (`agreedPrice` falsy) gets `payment_status = null` — it still counts as "agreed" but with no money owed.

---

### UI walkthrough (`src/app/payments/page.tsx`)

The page is a client component (`"use client"`) at route `/payments`, rendered inside a `max-w-4xl` centered column.

**Header (lines 60–66)**
- Title: **"Payments"** with a `CreditCard` icon.
- Subtitle: "Deals the AI closed. Open one to read the whole conversation, see whose inbox it is under, then pay and mark it done."
- **Refresh button** (top-right, ghost icon `RefreshCw`): calls `load()` — re-fetches `/api/payments`. Always enabled.

**Tab bar (lines 68–79)** — two tabs plus totals:
- **"Requires payment" tab** — shows count `owed.length`. Active state = violet underline. This tab lists all threads where `status !== "paid"` (i.e. `"owed"`, `"requested"`, and `null`-status agreed deals).
- **"Paid" tab** — shows count `paid.length`. Lists threads where `status === "paid"`.
- On the right: two running totals in `tabular-nums`:
  - **Owed:** `$` + `totalOwed` = sum of `agreedPrice ?? 0` over all owed threads (line 34).
  - **Paid:** `$` + `totalPaid` = sum of `paidAmount ?? agreedPrice ?? 0` over all paid threads (line 35).
  - Both use `.toLocaleString()` for thousands separators.

**Loading / empty states (lines 81–85)**
- While `loading`: a centered spinner (`Loader2`) with "Loading…".
- If the active tab has no rows: centered muted text — "No deals awaiting payment yet." (owed tab) or "Nothing paid yet." (paid tab).

**Row list (lines 86–131)** — one row per thread inside a `Card`, rows separated by dividers. Each row (lines 89–115):
- **Expand/collapse chevron button** (left): `ChevronDown` when open, `ChevronRight` when closed. Calls `toggle(t.id)` (see Flows).
- **Writer name** (`t.name`, bold), **publication** (`t.publication`, muted).
- **DR badge**: shown only if `t.dr != null`, rendered as `DR {Math.round(t.dr)}` (secondary badge).
- **Status badges** (conditional):
  - `requested` — amber outline badge, shown when `status === "requested"`.
  - `paid` — green outline badge, shown when `status === "paid"`.
  - (No badge is rendered for plain `"owed"`/`null` status.)
- **Inbox line** (with `User` icon): "under {sender ?? 'unknown inbox'}" — if `sentBy` exists and differs from `sender`, appends " (sent by {sentBy})".
- **Amount block** (right): big bold `$` + `(agreedPrice ?? 0).toLocaleString()` with the label **"agreed"** underneath. Note this always shows the **agreed** price, even in the Paid tab (it does not show `paidAmount` here).
- **Action buttons** (depend on tab):
  - **Owed tab** (lines 108–111): two stacked buttons —
    - **"Mark paid"** (green, `Check` icon) → `act(t.id, "paid")`.
    - **"Email to pay"** (outline, `Mail` icon) → `act(t.id, "request")`.
    - Both disabled while `busy === t.id`.
  - **Paid tab** (line 113): a single ghost **"Undo"** button → `act(t.id, "reset")`. Disabled while `busy === t.id`.

**Expanded conversation panel (lines 116–128)** — shown when `open === t.id`:
- Heading "Conversation".
- If the conversation for that id hasn't loaded yet (empty array): "Loading conversation…".
- Otherwise renders each message as a chat bubble: our messages (`from === "us"`) are violet-tinted and right-aligned (labeled "Us"); their messages are muted/left-aligned (labeled with the writer's name `t.name`). Bodies are `whitespace-pre-wrap` and word-broken, capped at 85% width.

**Client state & handlers**
- `threads` — all payment threads; `owed`/`paid` derived by filter (lines 31–32); `rows` = current tab's list.
- `open` — id of the currently expanded row (only one open at a time).
- `convo` — cache of conversation messages keyed by thread id (fetched lazily, once per id).
- `busy` — id of the row with an in-flight action (drives button disabling).
- `toggle(id)` (lines 37–44): if the row is open, collapse it; otherwise open it and, if not already cached, fetch `/api/payments/{id}` and store its `conversation` (falls back to `[]` on fetch error).
- `act(id, action)` (lines 46–56): sets `busy`, POSTs `{ action }` to `/api/payments/{id}`, then toasts based on the result and calls `load()` to refresh. Toast logic: if the JSON has `error`, `toast.error(error)`; else success toast per action — "Marked as paid" / `Payment request emailed to ${r.emailedTo}` / "Reset to owed". A thrown/network error toasts `e.message ?? "failed"`. `busy` is always cleared in `finally`.
- `load()` (lines 25–28): fetches `/api/payments`, sets `threads` to `d.threads ?? []`. Any fetch/parse error is **silently swallowed** (`catch { /* ignore */ }`) — the list just stays empty/stale; `loading` is cleared in `finally`.

---

### API routes / server logic

#### `GET /api/payments` — list all payment threads
File: `src/app/api/payments/route.ts`.
- **Params/body:** none.
- **Auth:** enforced upstream by `src/proxy.ts` — any non-`/api/auth`, non-health, non-cron request must have a valid session or is redirected to `/login`. There is **no per-user scoping**: the route returns *all* payment threads regardless of who is logged in.
- **Logic:** calls `getPaymentThreads()`.
- **Responses:**
  - `200 { threads: PaymentThread[] }` on success.
  - `500 { error: <message> }` if `getPaymentThreads` throws (e.g. a Supabase query error is rethrown from the query fn).

`getPaymentThreads()` (`queries.ts` ~2014):
1. Runs two Supabase queries in parallel on `outreach_emails` (both filtered `kind = "initial"`):
   - **agreed:** `negotiation_status = "agreed"`.
   - **withPay:** `payment_status is not null`.
2. If either query errors, it throws that error (→ surfaces as the route's 500).
3. Merges both result sets into a `Map` keyed by `id` (**dedupes** threads that match both queries).
4. Sorts descending by `paid_at ?? sent_at ?? created_at` (most recently paid/sent first).
5. Maps each row to `PaymentThread`. Notably:
   - `status: r.payment_status ?? (r.negotiation_status === "agreed" ? "owed" : null)` — if there's no explicit payment status, an agreed deal is synthesized as `"owed"`.
   - `agreedPrice`/`paidAmount` are `Number(...)` or `null`.
   - `name` falls back to `"Unknown"`, `publication` to domain name→host→`""`.

#### `GET /api/payments/[id]` — conversation for one thread
File: `src/app/api/payments/[id]/route.ts` (lines 7–14).
- **Params:** `id` (the initial/anchor email id) from the dynamic route (`params` is a Promise — awaited).
- **Body:** none.
- **Logic:** calls `getConversation(id)`.
- **Responses:**
  - `200 { conversation: ConvoMessage[] }`.
  - `500 { error: <message> }` on throw.

`getConversation(anchorId)` (`queries.ts` ~1993): selects rows where `id = anchorId OR parent_id = anchorId`, ordered by `created_at` ascending, and builds an interleaved oldest-first list:
- For each row: if it has a `body` and `status !== "failed"`, push a `{ from: "us", body, at: sent_at ?? created_at, kind }`; if it has a `reply_excerpt`, push `{ from: "them", body: reply_excerpt, at: replied_at }`.
- So it stitches together the initial email, follow-ups, and negotiation replies plus the writer's reply excerpts. **Failed sends are excluded.** This same function is shared with the Negotiation page.

#### `POST /api/payments/[id]` — mark paid / request / reset
File: `src/app/api/payments/[id]/route.ts` (lines 18–42).
- **Params:** `id` (anchor email id).
- **Body:** `{ action: "paid" | "request" | "reset" }`. The body is parsed with `.catch(() => ({}))`, so malformed/empty JSON yields `action = undefined`.
- **Validation:** `if (!["paid","request","reset"].includes(action)) → 400 { error: "bad action" }`.
- **Core:** always calls `markPayment(id, action)` first (this writes the status columns). Then, **only for `"request"`**, it sends the payment-due email (see below).
- **Responses:**
  - `200 { ok: true, emailedTo: <payer> }` for `"request"`.
  - `200 { ok: true }` for `"paid"` and `"reset"`.
  - `400 { error: "bad action" }` for an unrecognized/missing action.
  - `500 { error: <message> }` if `markPayment` (or the JSON await) throws.

`markPayment(id, action)` (`queries.ts` ~2037), `now = new Date().toISOString()`:
- **paid:** re-reads the row's `agreed_price`, then updates `{ payment_status: "paid", paid_at: now, paid_amount: agreed_price ?? null }`. So `paid_amount` is snapshotted from the current agreed price at the moment of marking.
- **request:** updates `{ payment_status: "requested", payment_requested_at: now }`. Does not touch amounts.
- **reset** (the `else` branch — any non-paid/non-request action that already passed validation, i.e. `"reset"`): updates `{ payment_status: "owed", paid_at: null }`. **Note it does NOT clear `paid_amount`** — a previously-paid thread keeps its old `paid_amount` after reset.

**The "request" email flow** (route lines 25–37): after `markPayment(id, "request")`:
1. Re-queries `outreach_emails` by `id` for `sender_email, agreed_price, subject, author(full_name, domain(host,name))` via `.maybeSingle()`.
2. Determines the payer: `sender_email` **or**, if null/empty, the hardcoded fallback `"abdullah.zubair@imagine.art"`.
3. Builds a plaintext body: "Payment due." + writer name, publication, `Agreed amount: ${price ?? "?"}`, thread subject, and an instruction to process the payment then mark it paid on the Payments page.
4. Calls `deliverOutreach({ to: payer, subject: "Payment due: ...", body, sender: payer })` — i.e. sends the email **from the payer's own Gmail to the payer themselves** (a self-notification). This whole call is wrapped in `.catch(() => {})` — **any send failure is silently swallowed**.
5. Returns `{ ok: true, emailedTo: payer }` regardless of whether the email actually went out.

`deliverOutreach` (`src/lib/email/deliver.ts`): because `sender` is set (the payer), it decrypts that user's stored Gmail app password. If the payer **has not configured an app password**, it returns `{ ok: false, error: "... hasn't set a Gmail app password ..." }` — but here that error is discarded by the `.catch(() => {})`, so no email is sent and the user still sees a success toast.

---

### Key checks & validations

- **Auth:** session required (via `proxy.ts` middleware) for all `/api/payments*` routes; no per-user ownership check on the data.
- **Action allowlist:** POST rejects anything not in `["paid","request","reset"]` with a 400.
- **Deal inclusion:** a thread appears in Payments only if it is a `kind = "initial"` row that is either `negotiation_status = "agreed"` **or** has a non-null `payment_status`.
- **Owed vs paid partition (client):** owed = `status !== "paid"`; paid = `status === "paid"`. There is no separate "requested" tab — requested deals live in the "Requires payment" tab with an amber badge.
- **Amount owed** is `agreed_price` (synthesized status `"owed"` when there is no explicit payment status but the deal agreed).
- **Amount paid** is snapshotted into `paid_amount` from `agreed_price` at mark-paid time.
- **Failed emails excluded** from the reconstructed conversation (`status !== "failed"`).

---

### Flows

**A. Deal becomes a payment owed (automatic, upstream of this page)**
1. AI negotiation runs (`src/lib/negotiation/run.ts`).
2. The AI drafts a reply with `statusHint === "agreed"` and a suggested/mentioned price.
3. `agreedPrice = draft.suggestedOffer ?? cls.priceMentioned ?? null`.
4. The **initial** email row is updated: `negotiation_status = "agreed"`, and if `agreedPrice` is truthy → `agreed_price = agreedPrice`, `payment_status = "owed"` (else `payment_status = null`).
5. Next `GET /api/payments` includes the thread; it shows in the "Requires payment" tab with the agreed amount.

**B. Viewing the ledger**
1. Page mounts → `useEffect` → `load()` → `GET /api/payments`.
2. Threads split into owed/paid; totals computed; the "Requires payment" tab is active by default (`tab = "owed"`).

**C. Reading a conversation before paying**
1. Click a row's chevron → `toggle(id)`.
2. If not cached, `GET /api/payments/{id}` fetches the interleaved conversation and caches it in `convo`.
3. Bubbles render oldest→newest; re-clicking collapses (cache retained).

**D. Marking paid**
1. In the owed tab, click **"Mark paid"** → `act(id, "paid")` → `POST /api/payments/{id}` `{action:"paid"}`.
2. `markPayment` reads `agreed_price`, sets `payment_status="paid"`, `paid_at=now`, `paid_amount=agreed_price`.
3. Toast "Marked as paid"; `load()` refreshes; the row moves to the "Paid" tab; totals update.

**E. Emailing the owning account to process payment**
1. In the owed tab, click **"Email to pay"** → `act(id, "request")` → `POST {action:"request"}`.
2. `markPayment` sets `payment_status="requested"`, `payment_requested_at=now` (status changes even if the email later fails).
3. Route resolves payer (`sender_email` or fallback Abdullah), builds and sends a self-addressed "Payment due" email via that payer's Gmail (swallowing errors).
4. Route returns `{ ok:true, emailedTo }`; toast "Payment request emailed to {emailedTo}"; row now shows the amber **requested** badge (still in the owed tab).

**F. Undo (reset paid → owed)**
1. In the paid tab, click **"Undo"** → `act(id, "reset")` → `POST {action:"reset"}`.
2. `markPayment` sets `payment_status="owed"`, `paid_at=null` (leaves `paid_amount` untouched).
3. Toast "Reset to owed"; row moves back to the "Requires payment" tab.

---

### Edge cases & cautions

- **Silent email failure on "Email to pay".** The `deliverOutreach(...).catch(() => {})` in the route swallows all send errors, and the route always returns `ok:true`. If the payer never set a Gmail app password (or SMTP fails), **no email is sent but the user sees "Payment request emailed to …"**. There is no delivery confirmation and `payment_status` is still flipped to `"requested"`. A maintainer debugging "I never got the email" should check the payer's app-password config in Settings.
- **The request email is a self-notification.** It is sent **from** the payer **to** the same payer address (`to: payer`, `sender: payer`). It is not sent to the writer and does not request money from anyone external.
- **Hardcoded fallback payer.** If `sender_email` is null, the request email defaults to `"abdullah.zubair@imagine.art"`. This address is hardcoded in `src/app/api/payments/[id]/route.ts` (line 30) — a maintainer changing the owner must edit code.
- **Reset does not clear `paid_amount`.** After Undo, the row is `owed` again but still carries the old `paid_amount`. It won't distort the owed tab (which uses `agreedPrice`), but the stored `paid_amount` is now stale/misleading if inspected directly, and would re-count toward `totalPaid` only if re-marked paid.
- **Status flips before side effects.** `markPayment` runs before the email send in the request branch, so a failed email still leaves a `"requested"` status — status and actual notification can diverge.
- **`paid_amount` follows `agreed_price` at mark-paid time.** There is **no way to record a paid amount different from the agreed price** — you cannot pay more/less than agreed through this UI; `paid_amount` is simply a snapshot of `agreed_price` (or `null` if agreed price was null).
- **Agreed-but-zero deals.** A negotiation that agrees with no price gets `payment_status = null` and `agreed_price = null`. It still appears in Payments (via the `negotiation_status = "agreed"` query) with status synthesized as `"owed"` and a **$0** amount. It will sit in the owed tab forever at $0 unless marked/reset.
- **No per-user scoping / no authorization granularity.** Every logged-in user sees and can act on *all* payment threads (including other people's inboxes). The only gate is "is there a session".
- **List fetch errors are invisible.** `load()`'s `catch { /* ignore */ }` means a failing `GET /api/payments` shows an empty/stale list with no error toast — easy to mistake for "no deals".
- **Amount display in Paid tab shows `agreed`, not `paid`.** The per-row big number is always `agreedPrice ?? 0` labeled "agreed", even in the Paid tab; the actual `paidAmount` only affects the header **Paid total** (`paidAmount ?? agreedPrice ?? 0`). If `paid_amount` ever diverged from `agreed_price`, the row wouldn't reflect it.
- **Anchor id assumption.** The conversation and the request-email lookup both key off the passed `id` as the **initial** email row. IDs of follow-up/negotiation child rows are not valid payment ids (they won't be in the list), so this is consistent, but any caller passing a child id to `GET/POST /api/payments/[id]` would get an empty conversation / a `maybeSingle()` miss (payer falls back to Abdullah, price shows `?`).
- **Conversation cache is not invalidated.** Once a thread's conversation is fetched into `convo[id]`, it is never re-fetched while the page is mounted (even after actions or Refresh), so new replies won't appear until reload.
- **No pagination.** `getPaymentThreads` loads all matching rows every time; fine at small scale but unbounded.

---

## Handbook (Negotiation Settings)

### Purpose

The Handbook is the single, global "brief" that GenAI Scout's AI email negotiator obeys. It is a **singleton settings record** (one row for the whole app) that controls:

- Whether the AI **auto-sends** negotiation replies or only **drafts** them for human approval (`ai_autonomy`).
- The **negotiation goal/criteria** text the model reads (`handbook`).
- **Tone** and **hard writing rules** for every generated email (`tone`, `style_rules`).
- **How aggressively** the AI concedes and **where in the price range it opens** (`aggressiveness`, `opening_percent`).
- The **price floor** and **currency** (`min_price`, `currency`).
- **Anti-highball** guidance for when the other side opens very high (`anti_highball`).
- **Max messages per thread** before it winds down (`max_thread_length`).
- **Pricing tiers**: the maximum monetary offer allowed for a site, keyed by Domain Rating (DR), organic traffic, and US traffic share (`pricing_rules`).

There is exactly one Handbook for the app; every AI-managed thread and the send-processor's auto-negotiation loop read the same record. Editing the Handbook changes behavior globally for all users and all threads.

Source anchors:
- Page UI: `src/app/handbook/page.tsx`
- API route: `src/app/api/negotiation/settings/route.ts`
- Read/write + defaults: `src/lib/negotiation/settings.ts`
- Tier resolution: `src/lib/negotiation/pricing.ts`
- Downstream consumers: `src/lib/negotiation/run.ts`, `src/lib/negotiation/agent.ts`, `src/app/api/emails/process/route.ts`, `src/app/api/negotiation/threads/route.ts`

Navigation: the Handbook is a top-level sidebar item (`src/components/layout/Sidebar.tsx:40` — `{ name: "Handbook", href: "/handbook", icon: BookOpen }`) and is also linked from the Negotiation page (`src/app/negotiation/page.tsx:239`).

---

### UI walkthrough

The page is a client component (`"use client"`) at route `/handbook` (`src/app/handbook/page.tsx`). Its entire state is one `Settings` object held in `s` (React `useState`). On mount it fetches `GET /api/negotiation/settings` and stores the response (`src/app/handbook/page.tsx:26-28`). Until that resolves (or if it fails), it renders a centered spinner: `Loader2` + "Loading…" (line 48-50). If the fetch rejects, `loading` is set false but `s` stays `null`, so the loading view persists — there is no dedicated error state on the page (see Edge cases).

All edits are **local only**; nothing is persisted until you click **Save**, which PUTs the *entire* settings object.

#### Header bar (lines 54-62)
- Title "Email Handbook" with a `BookOpen` icon and subtitle: "The single brief your AI negotiator follows — goals, tone, limits, and price."
- **Save button** (violet, top-right). While saving it shows a spinner (`Loader2`) and is disabled. On click it runs `save()` (lines 36-46): PUTs `s` as JSON to `/api/negotiation/settings`; on non-OK it throws with the server's `error` (or "save failed"); on success it replaces local state with the server's returned settings and shows toast "Handbook saved"; on failure it shows an error toast with the message.

#### Card 1 — AI autonomy toggle (lines 64-76)
- A single `Switch` bound to `s.ai_autonomy` (`onCheckedChange` → `set("ai_autonomy", v)`).
- **Visual cues when ON**: the card gets an amber border (`border-amber-500/40`) and the `ShieldAlert` icon turns amber; when OFF the icon is muted gray.
- Explanatory copy: when **off (recommended)** the AI **drafts** every negotiation reply and waits for you to approve/send; when **on** the AI **sends replies on its own** within these rules. It states "Hard-no's and unsubscribes are never auto-sent" — this is enforced in `run.ts` (see Downstream).

#### Card 2 — Negotiation brief (lines 78-109)
- **Goal & criteria** — `Textarea` (5 rows) bound to `s.handbook`. Placeholder: "e.g. Get ImagineArt featured in their article…". This is the core instruction injected verbatim into the model prompt.
- **Tone** — single-line `Input` bound to `s.tone`.
- **Handling high openers (anti-highball)** — `Textarea` (2 rows) bound to `s.anti_highball`.
- **3-column grid**:
  - **Max messages / thread** — number `Input`, `min={1}`; `onChange` = `parseInt(value) || 1` (empty/NaN falls back to 1). Bound to `s.max_thread_length`.
  - **Min price (floor)** — number `Input`, `min={0}`; `onChange` = `parseFloat(value) || 0` (empty/NaN falls back to 0). Bound to `s.min_price`.
  - **Currency** — text `Input` bound to `s.currency` (free text, e.g. "USD").

#### Card 3 — Strategy & style (lines 111-141)
- **How aggressive** — three buttons rendered from `["gentle","balanced","firm"]`. The selected one is filled violet (`variant="default"`); others are outline. Clicking sets `s.aggressiveness`. A helper line below changes with the selection:
  - gentle → "Concede slowly, settle low, lean to free inclusion if they hesitate."
  - firm → "Hold near the opening number, concede minimally, approach the ceiling only for high-value placements."
  - balanced (else) → "Move in modest steps and land comfortably under the ceiling."
- **Open at {opening_percent}% of the range** — native range `input` (`min=0 max=100 step=5`) bound to `s.opening_percent`. Helper: "0% opens at the floor, 100% opens at the tier ceiling. Lower opening = more room to negotiate up." The label live-updates with the current percent.
- **Writing rules (applied to every email)** — `Textarea` (3 rows) bound to `s.style_rules`. Placeholder: "e.g. No em dashes. Plain text. Short." Helper explicitly notes: "These are enforced on top of an automatic em dash and en dash strip on every generated email" (that strip is unconditional; see `sanitizeBody` in Downstream).

#### Card 4 — Pricing tiers (lines 143-171)
- Description clarifies the semantics: "The most we'll offer, by the site's Domain Rating and US traffic. The negotiator uses the highest tier a site qualifies for and never exceeds it. Metrics we can't verify yet (traffic/US) don't block a tier."
- Column headers (hidden below `sm` breakpoint): Min DR, Min traffic, Min US %, Max offer ({currency}), Label.
- Each rule in `s.pricing_rules` renders a row with:
  - **Min DR / Min traffic / Min US %** — number `Input`s. Empty string → the field is set to `undefined` (`e.target.value === "" ? undefined : Number(...)`), i.e. blank = "no constraint". Placeholder is an em-dash "—".
  - **Max offer** — number `Input`; `onChange` = `Number(e.target.value)` (no empty guard, so clearing it yields `0`).
  - **Label** — text `Input` bound to `r.label`.
  - **Delete** — ghost `Trash2` icon button → `delRule(i)` removes that rule from local state.
- **Add tier** button → `addRule()` appends a new rule with defaults `{ min_dr: 50, min_traffic: 10000, min_us_share: 50, max_offer: 100, label: "" }`.
- **Footer summary** (only when at least one rule exists): a `Badge` showing "up to {currency} {max of all max_offer}" for the top tier, plus "Sites below every tier get a placement-only ask (no money offered)."

Local state helpers: `set(key, value)` patches one field; `setRule(i, patch)` patches one rule; `addRule` / `delRule` add/remove rules (lines 30-34).

---

### API routes / server logic

#### Route: `src/app/api/negotiation/settings/route.ts`

**`GET /api/negotiation/settings`** (lines 5-11)
- No params/body.
- Returns `NextResponse.json(await getNegotiationSettings())`.
- Response branches:
  - **200** — the resolved `NegotiationSettings` object.
  - **500** — `{ error: e.message }` if `getNegotiationSettings()` throws.

**`PUT /api/negotiation/settings`** (lines 15-23)
- Body: a JSON object that may contain any subset of the settings fields. Parsed with `await req.json().catch(() => ({}))` — malformed/empty JSON becomes `{}` (no fields updated, not an error).
- Calls `saveNegotiationSettings(body)` and returns the freshly re-read settings.
- Response branches:
  - **200** — the saved `NegotiationSettings` (re-read from DB after upsert).
  - **500** — `{ error: e.message }` if the upsert/read throws (e.g. the table is missing or the DB is unreachable).

**Auth & permission checks**: There is **no auth or role check inside the route**. Access control is entirely at the edge in `src/proxy.ts`, which requires a valid Auth.js session for all paths except `/api/auth/*`, `/api/health`, `/login`, and requests carrying the `CRON_SECRET` bearer/`?key=`. Consequently: any **logged-in** user can read and overwrite the global Handbook; there is no admin/owner gate distinguishing who may change negotiation policy. (The `CRON_SECRET` bypass exists for the send-processor but nothing cron-related calls this settings route.)

#### Data layer: `src/lib/negotiation/settings.ts`

Types (lines 7-30):
- `PricingRule { min_dr?, min_traffic?, min_us_share?, max_offer, label? }`.
- `Aggressiveness = "gentle" | "balanced" | "firm"`.
- `NegotiationSettings` — all fields listed in Purpose, plus optional `updated_at`.

`DEFAULT_NEGOTIATION_SETTINGS` (lines 32-49) — the values returned when no row exists and the base that DB values are merged onto:
- `ai_autonomy: false`
- `handbook`: a long default brief ("Goal: get ImagineArt … featured/included … ALWAYS aim to pay the LEAST possible … open LOW, concede slowly … never jump to the tier ceiling …").
- `tone: "Warm, concise, human, professional. Never pushy or robotic."`
- `aggressiveness: "firm"`
- `opening_percent: 20`
- `style_rules: "Plain text only. Never use em dashes or en dashes; use commas or periods instead. No bracketed placeholders. Keep it short and human."`
- `max_thread_length: 4`
- `min_price: 0`
- `currency: "USD"`
- `anti_highball`: "If they open very high, do not anchor to it. Acknowledge, restate our value, come back near our tier ceiling, and move in small steps."
- `pricing_rules`: a single tier `{ min_dr: 50, min_traffic: 10000, min_us_share: 50, max_offer: 150, label: "DR 50+ & 10k US traffic" }`.

`parseRules(raw)` (lines 51-59) — normalizes the stored `pricing_rules`:
- Falsy → default rules.
- String → `JSON.parse`; object → used directly.
- If the result is an array, filters to items where `typeof r.max_offer === "number"` (drops malformed rules).
- Anything else / parse error → default rules.

`getNegotiationSettings()` (lines 61-69):
- `supabaseAdmin.from("negotiation_settings").select("*").eq("id", true).maybeSingle()`.
- If `data` is null (no row) → returns `DEFAULT_NEGOTIATION_SETTINGS`.
- Otherwise returns `{ ...DEFAULT, ...data, pricing_rules: parseRules(data.pricing_rules) }` — DB values override defaults; missing DB columns fall back to defaults; `pricing_rules` is JSON-decoded.
- Note: it destructures only `{ data }` — a query **error** is ignored (data stays undefined → defaults returned), so a missing table degrades silently to defaults on **read**.

`saveNegotiationSettings(patch)` (lines 71-79):
- Builds `row = { id: true, updated_at: new Date().toISOString() }`.
- Copies each scalar key from the patch **only if `!== undefined`**: `ai_autonomy, handbook, tone, aggressiveness, opening_percent, style_rules, max_thread_length, min_price, currency, anti_highball`.
- If `patch.pricing_rules !== undefined`, sets `row.pricing_rules = JSON.stringify(patch.pricing_rules)` (stored as a JSON string).
- `upsert(row, { onConflict: "id" })` — the table is a **singleton keyed on the boolean primary key `id = true`**; every save overwrites the one row.
- Returns `getNegotiationSettings()` (a fresh read), which is what the route sends back.

#### Tier pricing: `src/lib/negotiation/pricing.ts`

`maxOfferFor(dr, traffic, usShare, rules)` (lines 8-23) — the single source of truth for "the most we may offer a domain":
- Inner `meets(min, val)` returns true if `!min || min <= 0 || val == null || val >= min`. Two important implications:
  - A threshold of `0`, `undefined`, or absent = **no constraint**.
  - An **unverified** metric (`val == null`) does **not** fail a threshold. On the current free Ahrefs plan, DR is known but organic traffic and US share are null, so DR-based tiers apply now and traffic/US tiers auto-tighten once a paid source fills those in.
- Filters `rules` to those where all three thresholds are met.
- If **no rule matches** → returns `null`, meaning **"no paid offer, placement-only ask"**.
- Otherwise picks the rule with the **highest `max_offer`** and returns `{ offer, rule }`.

---

### What each control changes downstream

The Handbook is consumed in four places; here is the exact effect of each control.

- **`ai_autonomy`**
  - `run.ts:60` — `autonomy = settings.ai_autonomy && !opts.forceDraft && intent !== "hard_no" && intent !== "unsubscribe"`. Only when this is true (and a recipient exists) does `negotiateThread` actually **send** the drafted reply via `deliverOutreach` (`run.ts:73-76`); otherwise the reply is stored with `status: "draft"` for human approval.
  - `process/route.ts:153` — the send-processor's **auto-negotiation loop runs only if `settings.ai_autonomy`** is on. It scans up to 40 AI-managed initial emails that have a reply, skips ones already `agreed`/`declined`, skips autoresponder threads (`reply_kind === "auto"`), skips threads whose latest reply is already answered, and calls `negotiateThread()` (which auto-sends). This is what makes the "let AI handle replies" behavior actually reply on its own.
  - `threads/route.ts:60` — returned to the Negotiation page as `autonomy` so the UI can reflect the mode.

- **`handbook`** → injected as "NEGOTIATION BRIEF (obey): …" in the draft prompt (`agent.ts:168`).
- **`tone`** → injected as "TONE: …" (`agent.ts:169`).
- **`anti_highball`** → appended to the priced negotiation guidance (`agent.ts:163`).
- **`aggressiveness`** → maps through the `AGGRESSION` record (`agent.ts:36-40`) to a sentence of concession guidance appended to the price guidance (`agent.ts:160,163`). Unknown values fall back to `balanced`.
- **`opening_percent`** → computes the opening offer as `opening = max(floor, round(floor + (ceiling - floor) * (openPct/100)))` (`agent.ts:158-159`), clamped to `[0,100]`. Also used when the counterpart accepts our terms without naming a number, to close at the lowball opening (`agent.ts:148-150`). Fallback if unset is `40` (note: default is `20`).
- **`style_rules`** → injected as a HARD RULE line in the prompt (`agent.ts:175`). Independently, `sanitizeBody` (`agent.ts:24-34`) **always** strips em/en dashes (→ commas), collapses stray spacing, and trims — regardless of what `style_rules` says. So the dash strip is a guarantee; `style_rules` is additional soft guidance to the model.
- **`max_thread_length`** → `overLength = usCount >= settings.max_thread_length` (`agent.ts:127`). When exceeded, the prompt tells the model to wind down / propose a call rather than nag (`agent.ts:171`).
- **`min_price`** → passed as the `floor` to `draftNegotiationReply` (`run.ts:55`). The model is told never to go below it, and any model-suggested offer is clamped up to the floor (`agent.ts:198`). Acceptance below floor is not auto-closed (`agent.ts:141`).
- **`currency`** → string interpolated into all price sentences and the UI badges/labels (`agent.ts:143,152,163,177`; `threads/route.ts:60`).
- **`pricing_rules`** → fed to `maxOfferFor` in both `run.ts:48` and `threads/route.ts:34` to compute the per-thread **ceiling**. In `run.ts:49`, a per-email `max_offer` override (set on the Negotiation page) takes precedence over the tier; otherwise the tier's offer is used; if neither, ceiling is `null` = placement-only. The prompt branches on `ceiling == null` to instruct "DO NOT offer money — push for free/editorial inclusion only" (`agent.ts:161-162`). Any model offer is clamped down to the ceiling (`agent.ts:197`).

---

### Key checks & validations

- **PUT body parsing** tolerant: bad JSON → `{}`, treated as "update nothing" (route returns current settings unchanged apart from `updated_at`).
- **Field allow-list on save**: only the ten known scalar keys plus `pricing_rules` are written; unknown keys in the body are ignored (`settings.ts:73-76`). `updated_at` is always stamped server-side.
- **`undefined`-guarded copy**: a scalar is only written when present in the patch, so a partial PUT never nulls out unspecified fields. (The Handbook page always PUTs the full object, so this mainly matters for programmatic partial updates.)
- **`pricing_rules` sanitation** on read: `parseRules` drops any rule lacking a numeric `max_offer` and falls back to defaults on parse failure.
- **Tier threshold semantics**: `min <= 0` / absent / unverified (`null`) never blocks a tier (`pricing.ts:14`). Highest-`max_offer` matching tier wins.
- **Numeric input coercion in the UI**: `max_thread_length` → `parseInt || 1`; `min_price` → `parseFloat || 0`; tier threshold blanks → `undefined`; `max_offer` → `Number(value)` with no empty guard (blank becomes `0`).
- **Offer clamping** in the agent: final suggested offer is clamped to `<= ceiling` (if any) and `>= floor` (`agent.ts:197-198`), so a drifting model cannot exceed policy.

---

### Flows

**A. Load the Handbook**
1. Navigate to `/handbook`; `proxy.ts` confirms a session (else redirect to `/login`).
2. Component mounts, `GET /api/negotiation/settings` (`page.tsx:27`).
3. Route calls `getNegotiationSettings()`; if the row exists it is merged over defaults, `pricing_rules` decoded; else defaults returned.
4. Response populates `s`; spinner is replaced by the form.

**B. Edit and save**
1. User edits any field(s); each edit patches local `s` only.
2. User clicks **Save** → `PUT /api/negotiation/settings` with the entire `s` object (`page.tsx:40`).
3. Route calls `saveNegotiationSettings(body)` → upsert of the singleton row (`id = true`) with a fresh `updated_at`; `pricing_rules` stored as a JSON string.
4. Route re-reads and returns the saved settings; the page replaces `s` with the response and shows "Handbook saved".
5. On any non-OK response the page throws and shows an error toast (no partial retry).

**C. Human-approval negotiation (autonomy OFF — the default)**
1. A reply arrives on an AI-managed thread; it appears on the Negotiation page.
2. `negotiateThread()` runs (page button or processor): reads settings, classifies intent, computes `ceiling` (override → tier → null) and `floor = min_price`, drafts a reply obeying the Handbook.
3. Because `ai_autonomy` is false, `autonomy` is false → the reply is stored `status: "draft"` for the human to review and send.

**D. Autonomous negotiation (autonomy ON)**
1. The send-processor run (`/api/emails/process`) reaches the auto-negotiation block; since `ai_autonomy` is true it scans AI-managed initials with unanswered replies (≤40 per run).
2. For each, `negotiateThread()` drafts a reply; `autonomy` is true unless the intent is `hard_no`/`unsubscribe`.
3. If a recipient address is resolvable (contact `mailto` or `recipient_override`), the reply is **sent immediately** via `deliverOutreach`; status becomes `sent` (or `failed`). Hard-no / unsubscribe still only draft a polite sign-off — never auto-sent.

**E. Pricing tier resolution (per thread)**
1. The site's `dr`, `organic_traffic`, `us_traffic_share` come off the domain record.
2. `maxOfferFor(dr, traffic, usShare, pricing_rules)` filters to matching tiers (unverified metrics never disqualify) and picks the highest `max_offer`.
3. That becomes the ceiling (unless a per-email `max_offer` override exists). If no tier matches, ceiling is `null` → the AI is told to seek a free/editorial placement with no money offered.

---

### Edge cases & cautions

- **No role gate / global blast radius.** The route has no in-handler auth, and there is no admin check anywhere — *any* logged-in user can rewrite the one shared Handbook, including flipping `ai_autonomy` on, which immediately arms auto-sending for everyone's AI-managed threads on the next processor run. Treat this as a privileged, shared control.
- **Singleton with last-write-wins.** Every save upserts the same `id = true` row and PUTs the *entire* object; there is no optimistic concurrency (no `updated_at` precondition). Two people editing concurrently silently clobber each other — the last Save wins wholesale.
- **`negotiation_settings` table is not in the versioned migration.** `migrations/001_initial.sql` does not create `negotiation_settings`; the table must be created out-of-band in Supabase. Consequences if it is missing: **reads** degrade silently to `DEFAULT_NEGOTIATION_SETTINGS` (the query error is swallowed in `getNegotiationSettings`), but **saves** fail — the upsert throws and the route returns 500, surfacing as a "save failed" toast.
- **`opening_percent` default mismatch.** The stored default is `20`, but the agent's fallback when the value is absent is `40` (`agent.ts:149,158`). These only diverge if the DB value is null/undefined (e.g. a row created without that column). Normal saves always write a concrete number.
- **Blanking Max offer silently means $0.** The Max-offer input uses `Number(e.target.value)` with no guard, so clearing it stores `0`. Since `parseRules` accepts any numeric `max_offer`, a `0` tier is valid and will cap that tier's offer at `0` (effectively "match this tier but offer nothing"), which is different from "no tier matched → placement-only". Watch for accidentally-zeroed tiers.
- **All-blank thresholds = catch-all tier.** A rule with DR/traffic/US all blank (or `<= 0`) matches every domain (`meets` returns true), so its `max_offer` becomes a universal floor tier. Useful intentionally, dangerous accidentally (it removes the "placement-only" branch for low-DR sites).
- **Empty currency / empty handbook are savable.** No validation prevents saving an empty `currency`, `tone`, or `handbook`. An empty currency renders awkward strings downstream ("up to  150", "You may offer up to  100"); an empty handbook weakens the model's brief. There is no required-field enforcement.
- **The em/en dash strip is unconditional.** Even if you delete the dash rule from `style_rules`, `sanitizeBody` still replaces em/en dashes with commas on every generated email. `style_rules` cannot re-enable dashes; it only adds guidance the model *tries* to follow.
- **Autonomy still needs a deliverable recipient.** With autonomy on, if no contact `mailto` / `recipient_override` resolves, the reply is drafted (not sent) and `recipientMissing` is flagged (`run.ts:101`). A test-send override on the initial email keeps the whole AI thread on the test address (`run.ts:63-65`).
- **Auto-negotiation is bounded and skips certain threads.** The processor loop caps at 40 initials per run and skips autoresponders, already-answered replies, and `agreed`/`declined` threads. High reply volume may not all be handled in a single run; it catches up on subsequent runs.
- **Page has no explicit error UI.** If the initial GET rejects, the page stays on the loading spinner (only `loading=false` with `s=null` still renders the spinner branch). A failed load looks like a perpetual load, not an error.
- **`min_price` is a single global floor.** It applies to every thread and every tier; the opening offer is always computed within `[min_price .. thread ceiling]`. There is no per-tier floor.

---

## Email Finder & Enrichment

### Purpose

This area finds and verifies **contact emails** (and **LinkedIn URLs**) for writer/author prospects that don't have one yet. Discovery collects authors + the articles they wrote, but usually only their name + publication domain — not a way to reach them. The Email Finder closes that gap on demand: you pick a scope (all prospects or a single campaign), pick what to find (emails or LinkedIns), press a button, and it runs a per-person **cascade** of free/cheap sources (page scraping → LinkedIn discovery → Blitz → AI scan → verified pattern guessing) while streaming live progress. Results are stored as `contacts` rows so downstream outreach/negotiation can use them. It also owns per-author maintenance actions (re-find, discard, mark-emailed) and a run-history log.

A separate, related concern documented here is **Domain Rating (DR)** via Ahrefs' free endpoint (`src/lib/enrich/domainRating.ts`) — used by discovery's qualification filter, not the Email Finder UI, but it lives in `src/lib/enrich/` and is described below.

> **Important architectural note.** There are **two** enrichment code paths in `src/lib/enrich/`:
> 1. **The on-demand cascade** (`cascade.ts` → `run.ts`), which is what the **Email Finder page** actually runs. It does **not** use Hunter or the `patterns.ts`/`resolve.ts` candidate generator.
> 2. **A legacy discovery-time waterfall** (`resolve.ts`, using `patterns.ts` `emailCandidates`, `hunter.ts`, `guessAndVerify`). This is only invoked inside `src/lib/pipeline/run.ts` (Stage 2.5) and is **disabled by default** — it runs only when `ENRICH_ON_DISCOVERY=true` (see `pipeline/run.ts:566-598`). So Hunter.io, `emailCandidates`, and `guessAndVerify` are effectively dormant unless that env flag is set.
>
> This doc covers both but flags which is which, because it is a common source of confusion for maintainers.

---

### UI walkthrough — `src/app/email-finder/page.tsx`

A single client page (`"use client"`), max-width `4xl`. It doubles as **Email Finder** and **LinkedIn Finder** depending on the `mode` toggle. Component: `EmailFinderPage()` (line 27).

#### Header (lines 139-149)
- **Title + icon** switch on `mode`: `Link2` icon (LinkedIn blue `#0a66c2`) + "LinkedIn Finder" when `mode === "linkedin"`, else `AtSign` icon (violet) + "Email Finder".
- **Subtitle** also switches: LinkedIn mode explains it finds/stores LinkedIns (posts → socials → web search) at a higher hit-rate, and that the email finder later converts a LinkedIn into an email via Blitz. Email mode lists the cascade sources ("scans posts, LinkedIn → Blitz, socials, verified pattern guessing (Reoon), and AI scan").

#### Controls card (lines 152-215)
- **"Find" select** (lines 156-164): options `Emails` (`email`) / `LinkedIns` (`linkedin`). Sets `mode`. **Disabled while a run is active** (`running`).
- **"Campaign" select** (lines 171-179): `All prospects` (empty value) plus one `<option>` per campaign loaded from `/api/campaigns` on mount (line 57). Sets `campaignId`. **Disabled while running.**
- **"Brand new only" checkbox** (lines 182-192): rendered **only in email mode**. Bound to `onlyNew`. Tooltip: "Skip authors already searched before, even if it failed — only try ones we've never attempted." Skips any author with a non-null `email_search_attempted_at`. **Disabled while running.** The empty `opacity-0` label above it is a spacer to keep the row baseline-aligned.
- **Pending counter** (lines 194-202): shows a spinner + "counting…" while `pending === null`; otherwise a big violet number = `pending` (authors without an email/LinkedIn) with the label "without an email"/"without a LinkedIn" (+ " (never searched)" when `onlyNew`), and a muted "of N total prospects" (`totalProspects`). Fed by `/api/enrich/pending`.
- **Action button** (lines 204-214):
  - While running: an **outline "Stop" button** (red, `Square` icon) → calls `stop()`.
  - While idle: a **primary "Find Emails" / "Find LinkedIns" button** (violet for email, LinkedIn-blue for linkedin). **Disabled** when `starting` is true or `pending === 0` (nothing to do). → calls `findEmails()`.

#### Progress panel (lines 217-249)
Shown when `status` exists AND (`status.running` OR `status.done > 0`).
- **Header row**: left = "Finding emails" (running) or "Done" (finished), with " · {campaignName}" appended if present. Right = a tabular count line: `done`/`total`, then green "`found` found", then (if any) amber "`N` API issue(s)". `erroredCount` (line 135) = number of people with `status === "error"` — i.e. a provider failed, distinct from a real miss.
- **Progress bar** (lines 231-233): violet fill, width `pct` = `round(done/total*100)`, `0` when total is 0.
- **Per-source breakdown** (lines 234-241): only when finished, `found > 0`, and `bySource` present. Renders "`N` via {label} · …", mapping source keys through `SOURCE_LABEL` (lines 14-19).
- **API-issue caption** (lines 242-247): only when finished and `erroredCount > 0`. Amber warning: "N couldn't be completed because an API failed (not confirmed missing) — re-run to retry them."

`SOURCE_LABEL` map (lines 14-19) — the human labels for each `source` value:
`page-scrape`→"on their page", `blitz-linkedin`→"LinkedIn → Blitz", `social`→"social profile", `ai-scrape`→"found on site", `hunter`→"Hunter", `blitz`→"Blitz", `pattern-verified`→"pattern ✓ verified", `pattern-catchall`→"pattern · GUESS (catch-all)", `pattern`→"pattern · GUESS", `linkedin-post`→"LinkedIn on a post", `linkedin-social`→"LinkedIn via social", `linkedin-websearch`→"LinkedIn via search".

#### "Viewing a past run" banner (lines 252-261)
Shown when `viewingRunId` is set. Violet strip: "Viewing a past run · {campaignName} — found/total found" plus a **"Back to live"** button that clears `viewingRunId` and `status` (`backToLive`, line 69).

#### Activity list (lines 263-333)
One row per person (`status.people`, already sorted most-recent-active first and capped at 200 by the buffer). Header says "Activity" (live) or "Run activity" (past run). Scroll region `max-h-[560px]`. Each row:
- **Expand chevron** (`ChevronRight`, rotates when open) toggles `expanded` for that person's `name`.
- **Status icon**: `found` → green `CheckCircle2`; `running` → spinning violet `Loader2`; `error` → amber `AlertTriangle`; else (`not_found`) → muted `XCircle`.
- **Name button** (lines 286-293): clicking opens the shared `ProspectDrawer` for `p.authorId` via `openAuthor()` (fetches `/api/authors/{id}`). Disabled (no hover underline) when `authorId` is absent.
- **Right-side result** (lines 294-313), clicking it toggles expand:
  - `found` + LinkedIn result (`source` starts with `linkedin-`): the URL rendered as a clickable LinkedIn-blue link (protocol stripped for display) + the source label.
  - `found` + email result: monospace email, **green if "confident", amber if a "guess"**. `isGuess()` (line 23) = source is `pattern` or `pattern-catchall`; everything else is `isConfident()`. Label colored to match.
  - `running`: the latest step text (`liveText` = last element of `p.steps`), monospace, truncated.
  - `error`: amber "couldn't complete — {first issue}", with all issues in the `title` tooltip.
  - `not_found`: muted "no email found" / "no LinkedIn found" (per mode).
- **Expanded steps** (lines 315-327): the full `p.steps` list, monospace, one bullet each. Steps beginning with `⚠` render amber (warnings/provider failures).

#### Run history (lines 335-356)
Shown when `runs.length > 0` (loaded from `/api/enrich/runs`). Each row is a button: finished-at timestamp (localized short) · campaign name (or "All prospects") · green "`found` found / `done` checked" · chevron. Clicking calls `openRun(id)` (lines 62-67) which stops live polling, sets `viewingRunId`, and loads that run's full people/steps from `/api/enrich/runs/{id}` into the **same** activity UI. The currently-viewed run row is highlighted.

#### Shared drawer
`<ProspectDrawer>` (line 358) — opened by clicking a person's name. It hosts the per-author **Emailed** toggle, **Discarded** toggle, and **Re-find email** button (see the per-author actions section).

#### Client state & polling logic
- On mount (lines 56-59): loads campaigns + run history.
- `loadPending(cid, mode, newOnly)` (lines 71-82): GETs `/api/enrich/pending` with `campaign_id`, `mode=linkedin` (only if linkedin), `only_new=true` (only if email + newOnly). Sets `pending` and `totalProspects`.
- Effect on `[campaignId, mode, onlyNew]` (lines 101-107): recomputes pending, and **resumes polling if a run is already active** (calls `/api/enrich/status`, and if `running`, starts `poll()`). This is what makes the page survive a refresh mid-run.
- `poll()` (lines 84-99): every **2000ms** fetches `/api/enrich/status`, updates `status`; when the run stops it clears the timer, clears `starting`, refreshes pending, and reloads run history.
- `findEmails()` (lines 109-124): clears `viewingRunId` (back to live), sets `starting`, POSTs `/api/enrich/run` with `{ campaign_id?, mode, only_new? }`. On `{started:true}` → `poll()`. Else: if `{alreadyRunning:true}` → toast "A run is already in progress." and still `poll()`; otherwise error toast with `data.reason`.
- `stop()` (lines 126-129): POSTs `/api/enrich/stop`, toasts "Stopping after the current lookup…".
- `running` (line 131) = `status.running || starting` (so the button flips to Stop immediately, before the first poll).

---

### API routes / server logic

#### `POST /api/enrich/run` — start or continue a run (`src/app/api/enrich/run/route.ts`)
`export const maxDuration = 300` (Vercel 300s function cap).
Request body (JSON, tolerant — `{}` on parse error): `{ campaign_id?: string, mode?: "email"|"linkedin", only_new?: boolean, continue?: boolean }`. `findMode` defaults to `email` unless body.mode is exactly `"linkedin"` (line 18). **No auth check** in the route itself (relies on the app-level proxy / not exposed publicly).

Two branches:
1. **Continuation chunk** (`body.continue === true`, lines 21-28): loads the stored target list (`getEnrichTargets`) and restores in-memory run state from the Redis snapshot (`restoreFromSnapshot`). If either is missing → `{ continued:false, reason:"nothing to continue" }`. Otherwise resumes `enrichLoop(targets, mode, campaign_id, resumeAt)` inside `after()` where `resumeAt = doneCount()`, and returns `{ continued:true, resumeAt, remaining }`. Triggered by QStash, not the user.
2. **Fresh start** (lines 30-52):
   - If a run is already active anywhere (`checkRunning()`, reads durable Redis snapshot) → `{ started:false, alreadyRunning:true }`. **Single-run lock.**
   - Builds targets: linkedin mode → `getAuthorsNeedingLinkedin(campaign_id)`; email mode → `getAuthorsNeedingEmail(campaign_id, onlyNew)`.
   - If `targets.length === 0` → `{ started:false, total:0, reason }` where reason is mode-specific ("Every author already has a LinkedIn on file." / "No brand-new authors to search…" / "No authors without an email.").
   - Else: fetch campaign (for its name), `startEnrich(campaign_id ?? "all", total, name)`, `setEnrichTargets(targets)` (stored in Redis for continuation), `snapshotToRedis()` (so the status poll on another instance sees it immediately), then kick off `enrichLoop(targets, mode, campaign_id, 0)` via `after()` (survives past the HTTP response). Returns `{ started:true, total, mode }`.

#### `GET /api/enrich/pending` — count of authors still needing an email/LinkedIn (`.../pending/route.ts`)
Query: `campaign_id?`, `mode` (`linkedin` if literally "linkedin", else email), `only_new` (`true`). Calls `getFinderCounts(...)`. Returns `{ count: needing, total }`. No auth check.

#### `GET /api/enrich/status` — live progress (`.../status/route.ts`)
No params. Reads the **durable** snapshot (`getEnrichDurable()` — Redis-first, memory fallback). If nothing → `{ running:false, total:0, done:0, found:0, bySource:{}, people:[] }`. Else returns `{ running, total, done, found, bySource, campaignName, people }`. `people` is one entry per author `{ name, authorId?, publication?, steps[], status, email?, source?, issues? }`. **Stale-run handling:** if a snapshot says `running:true` but the heartbeat is missing or older than 60s (`STALE_MS`, enrichBuffer line 114), it's reported as `running:false` (orphaned/dead process) so the UI unsticks and a new run can start.

#### `POST /api/enrich/stop` — abort (`.../stop/route.ts`)
No body. Calls `requestAbort()` → sets in-memory `aborted` **and** a durable `enrich:abort` Redis flag (TTL 1h). Always returns `{ ok:true }`. Works cross-instance because the loop checks the Redis flag before each author. It's a **cooperative** stop — it takes effect *after the current author's lookup finishes*, not instantly.

#### `GET /api/enrich/runs` — run-history list (`.../runs/route.ts`)
Returns `getEnrichmentRuns(25)`: the 25 most recent `enrichment_runs` rows (`id, campaign_name, total, done, found, by_source, started_at, finished_at`), newest `finished_at` first.

#### `GET /api/enrich/runs/[id]` — one run's full detail (`.../runs/[id]/route.ts`)
Path param `id`. `getEnrichmentRun(id)`; 404 `{ error:"not found" }` if missing. Returns `{ running:false, total, done, found, bySource: by_source ?? {}, campaignName: campaign_name, people: people ?? [] }` — the exact shape the activity UI consumes, so a past run replays identically.

#### `GET /api/authors/[id]` — author detail (`src/app/api/authors/[id]/route.ts`)
`getAuthorDetail(id)` → a `ProspectCard` (profile + contacts + all articles). 404 if missing. Used by the activity list to open the drawer.

#### `POST /api/authors/[id]/refind` — single-author cascade (`.../refind/route.ts`)
`export const maxDuration = 120`. Runs the **full email cascade for one author** synchronously and returns the verbose steps + result (does NOT go through the run buffer / Redis / run-history). Logic:
1. `getAuthorDetail(id)`; 404 if missing.
2. Requires `d.domain.host`; if absent → `{ error:"no publication domain for this author", steps:[], found:false }` (200, not an HTTP error).
3. Runs `resolveEmailCascade({ id, name, host, publication })` with local `steps`/`issues` arrays and an `onLinkedin` capture. `.catch(() => null)` so a thrown cascade error becomes "not found".
4. Persists any LinkedIn discovered en route as a `linkedin` contact (`source:"linkedin-cascade"`), even if no email was found.
5. Validates the email against `EMAIL_RE` and `isRoleEmail` — a role email or malformed address is discarded (`r=null`).
6. If a valid email: `upsertContact({ type:"mailto", value:"mailto:<email>", confidence: score/100 || 0.8, source, verified_syntax:true })`.
7. Returns `{ steps, issues, status, found, email, source }` where `status` = `found` | `error` (issues present, so the miss may be a provider failure) | `not_found`.
Rendered inline in the drawer: green email + source on success; amber "Couldn't complete — {issues}. Not confirmed missing; try again." on `error` (ProspectDrawer lines 261-266). **Note:** unlike the bulk loop, refind does **not** call `markEmailSearchAttempted`, so re-finding one author doesn't mark them "searched" for the brand-new-only filter.

#### `PATCH /api/authors/[id]/discard` — discard toggle (`.../discard/route.ts`)
Body `{ discarded }`. `setAuthorDiscarded(id, !!discarded)`. Returns `{ ok:true, discarded }`. Discarded authors are excluded from every workflow (`runWorkflowFilters` filters them out) — a hard hide, independent of contacted state.

#### `GET /api/authors/[id]/contacted` — effective contacted state (`.../contacted/route.ts`)
`isAuthorContacted(id)` → `{ contacted, override, hasHistory }`.

#### `PATCH /api/authors/[id]/contacted` — set/clear contacted override
Body `{ contacted: boolean | null }`. Coerced (lines 18): `null` → clear override (revert to derived-from-outreach); `true` → force "won't email again"; `false` → force "eligible to email again"; anything else → `null`. `setContactedOverride(id, value)`, re-reads state, returns `{ ok:true, ...state }`. Errors → 500 `{ error }`.

---

### The email cascade — `src/lib/enrich/cascade.ts` → `resolveEmailCascade()`

The heart of the finder. Called per author. Emits `onStep(detail)` for the live feed, `onIssue(detail)` for **real provider failures** (distinct from a clean "nothing found"), and `onLinkedin(url)` when a LinkedIn is discovered en route so the caller can persist it. Uses two cross-author caches passed in by the loop: `patternCache` (domain → inferred pattern) and `domainVerify` (domain → Reoon verdict). Order:

1. **Reuse a stored LinkedIn** (lines 60-66): if `getStoredLinkedin(id)` returns one, use it and **skip the post scan + web search entirely** — a big cost saver (no paid search).
2. **Scan the author's posts** (lines 68-80, only if no stored LinkedIn): fetch up to `MAX_POSTS_SCAN = 50` (line 16) article URLs (`getAuthorArticleUrls`, most-recent-first). For each, `scrapePageSignals(url)`:
   - A direct **non-role email** on the page → **return immediately** `{ source:"page-scrape", score:90 }`.
   - Otherwise absorb social links (linkedin/twitter/instagram/mastodon/personalSite, first-wins via `??=`). **Stops scanning the moment a LinkedIn is found** (line 78) — that's enough to get the email via Blitz.
3. **Check social profiles** (lines 82-92, only if still no LinkedIn): scrape the author's X, Instagram, then personal site in that order. A direct email there → **return** `{ source:"social", score:80 }`. Else absorb a LinkedIn if found.
4. **Web search for LinkedIn** (lines 94-101, only if still none): `findLinkedinUrl(name, publication)` — the **paid** search step (Tavily/Google/Brave/Serper). `linkedinIsNew = !!linkedin` tracked so only a *newly discovered* LinkedIn is persisted (a stored one is already saved).
5. **Harvest LinkedIn** (line 107): if newly discovered, fire `onLinkedin(url)` so the caller upserts it — an **email run also collects LinkedIns**.
6. **LinkedIn → Blitz → email** (lines 109-116, if a LinkedIn exists and `blitzEnabled()`): `linkedinToEmail(url)`. A returned **non-role** email → **return** `{ source:"blitz-linkedin", score:90 }`. A generic/role email is skipped; a Blitz failure is recorded via `onIssue`.
7. **AI-scan the site** (lines 118-123, if `aiScrapeEnabled()`): `aiScrapeEmail(name, host)` asks Claude (via OpenRouter) for an email *actually present* on `/contact`, `/about`, or the homepage. A hit → **return** `{ source:"ai-scrape", score:75 }`.
8. **Domain pattern guess** (lines 125-155, last resort): compute the **registrable** mail domain (`registrableDomain(host)` — research.ibm.com → ibm.com). Resolve the domain's pattern once (cached): inferred from known emails on that domain (`getKnownEmailsByDomain`) via `resolveDomainPattern`. If a pattern exists, build `local@mailDomain`, **verify once per domain** with Reoon (cached in `domainVerify`), and always return the constructed email tagged by verdict:
   - `safe` → `{ source:"pattern-verified", score:95 }`
   - `catch_all` → `{ source:"pattern-catchall", score:65 }`
   - `invalid`/`unknown` → `{ source:"pattern", score:55 }`
   A per-person invalid/unknown verdict is treated as "can't confirm", **not** "wrong" — the pattern email is still returned (tagged as a guess). Only domain-level truths (`safe`/`catch_all`) are cached.
9. If no pattern applies → `return null` (genuine miss).

### The LinkedIn cascade — `src/lib/enrich/linkedinCascade.ts` → `resolveLinkedinCascade()`

Lighter sibling used by **LinkedIn mode**. Hunts only for a LinkedIn URL (no Blitz, no email). Order: scan up to 50 posts (`source:"post"`) → check X/Instagram/personal-site socials (`source:"social"`) → web search by name + publication (`source:"websearch"`). Web-search failures go to `onIssue`. Returns `{ url, source }` or null. The loop then stores it as a `linkedin` contact with `source: "linkedin-<source>"` and `confidence 0.85`.

### The run loop — `src/lib/enrich/run.ts`

- `EMAIL_RE` (line 12): `^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$` — final syntax gate.
- `CHUNK_BUDGET_MS` (line 19): `200_000` on serverless (Vercel), `Infinity` locally. Leaves headroom under the 300s limit.
- **`processOne(target, mode, caches)`** (lines 26-79):
  - **Person-name gate first** (line 29): if `!isLikelyPersonName(name, publication)` → immediately record a `not_found` result and return (never spends any API call on non-people).
  - LinkedIn mode: run `resolveLinkedinCascade`; on hit upsert a `linkedin` contact + `enrichResult(found:true, email:url, source:"linkedin-<src>")`; else `enrichResult(found:false, issues)`.
  - Email mode: run `resolveEmailCascade`, capturing a discovered LinkedIn. Persist that LinkedIn (`source:"linkedin-cascade"`) if any. Validate email against `EMAIL_RE` + `isRoleEmail` (drop if bad). **`markEmailSearchAttempted(id)` is called regardless of outcome** (line 71) — this is what powers the "brand new only" filter on future runs. On a valid email: upsert `mailto` contact (`confidence = score/100 || 0.8`, `verified_syntax:true`) + `enrichResult(found:true,…)`. Else `enrichResult(found:false, issues)`.
- **`enrichLoop(targets, mode, campaignId, startIndex)`** (lines 85-126):
  - Fresh `caches` per invocation (pattern + domainVerify) — note these do **not** persist across QStash continuation chunks.
  - Snapshots to Redis every **2500ms** on an interval.
  - Loops from `startIndex`; before each author: `checkAbort()` (durable) → break if stop was requested.
  - **Chunk hand-off** (lines 101-106): if `Date.now() - startedAt > CHUNK_BUDGET_MS`, snapshot, then `qstashPublish("/api/enrich/run", { continue:true, campaign_id, mode })`. If QStash accepted → return WITHOUT finishing (next chunk resumes at `doneCount()`). If no QStash → break (partial; a manual re-run continues from remaining not-yet-emailed authors).
  - Per-author `try/catch` — a thrown error becomes a `found:false` result, never aborts the whole run.
  - On natural completion/abort/no-QStash: `finishEnrich()`, final snapshot, and `saveEnrichmentRun(...)` to persist the run to history, then `clearEnrichTargets()` (also clears the abort flag).

### Run state buffer — `src/lib/enrich/enrichBuffer.ts`

In-memory `current` run is the hot path; mirrored to Upstash Redis as a JSON snapshot so status polls and continuation chunks work across serverless instances. Key facts:
- `MAX_STEPS = 60` per person (oldest dropped); `TTL = 3600s` on all Redis keys.
- Keys: `enrich:snapshot`, `enrich:abort`, `enrich:targets`.
- `getEnrich()` returns people **sorted by `lastAt` desc, capped at 200**.
- `enrichResult` sets status: `found` if found, else `error` if there are issues, else `not_found`; increments `done`, and on a hit increments `found` + `bySource[source]`.
- `getEnrichDurable()` — Redis-first; a `running` snapshot with missing/`>60s`-stale heartbeat is coerced to `running:false` (orphan detection).
- `restoreFromSnapshot()` rebuilds `current` from Redis so a continuation chunk resumes with accumulated people/counters (`running:true`, `aborted:false`).
- `checkRunning()` (durable) blocks a second concurrent start.
- Redis is **optional**: with no Redis (local dev), everything is in-memory and runs in a single pass (no chunking, since `isServerless()` is false there too).

---

### Providers & keys

| Provider | Module | Env key(s) | Role in the **cascade** | Free tier / notes |
|---|---|---|---|---|
| **Blitz API** | `blitz.ts` | `BLITZ_API_KEY` (header `x-api-key`) | Step 6: LinkedIn URL → email. The "unlock". | "Unlimited credits"; rate limit **5 req/s per endpoint**. Chain: domain→company LinkedIn→employees→match by name→LinkedIn→email. |
| **Web search** | `findLinkedin.ts` → `search/webSearch.ts` | `TAVILY_API_KEY` (pooled, rotates on quota), or `GOOGLE_CSE_KEY`+`GOOGLE_CSE_CX`, or `BRAVE_SEARCH_API_KEY`, or `SERPER_API_KEY` | Step 4: find LinkedIn by name+publication. | Tavily 1k/mo (recommended, key-pool w/ exhaustion rotation), Google CSE 100/day, Brave 2k/mo, Serper 2.5k one-time. First configured provider wins. |
| **AI scrape** | `aiScrape.ts` | `OPENROUTER_API_KEY` | Step 7: Claude reads /contact,/about,home for an email. | Model `anthropic/claude-haiku-4-5`, temp 0, max 30 tokens, 20s timeout. Uses YOUR Claude access, not paid scraping credits. |
| **Reoon** | `reoon.ts` → `verify.ts` | `REOON_API_KEY` | Step 8: verify a constructed pattern email (POWER mode SMTP + catch-all). | 600 verifications/mo free. Falls back to local `deep-email-validator` SMTP when unavailable (weaker; needs port 25 → usually blocked on serverless). |
| **Ahrefs DR (free)** | `domainRating.ts` | `AHREFS_API_KEY` (optional Bearer) | **Not in the cascade** — used by discovery qualification. | Free public endpoint, 0 units. Unauthenticated works today; a **free** key required from ~2026-08-01. |
| **Hunter.io** | `hunter.ts` | `HUNTER_API_KEY` | **Dormant** — only in the legacy `resolve.ts` waterfall (`ENRICH_ON_DISCOVERY=true`). | 25 finds/mo free; `minScore=70` gate; drops results on 429. |
| **QStash** | `qstash.ts` | `QSTASH_TOKEN` + (`APP_URL`|`NEXTAUTH_URL`), forwards `CRON_SECRET` | Chunk continuation on Vercel. | No-op locally. |
| **Redis** | `redis.ts` | Upstash (see redis module) | Cross-instance run state / abort / targets. | Optional; in-memory fallback. |

Every provider **gracefully degrades**: a missing key or a failure returns `null`/`[]` and the cascade moves to the next step. `blitzEnabled()`, `aiScrapeEnabled()`, `reoonEnabled()`, `hunterEnabled()`, `searchEnabled()` gate each step on key presence.

---

### The person-vs-role filter — `src/lib/enrich/personFilter.ts`

Two guards, applied so we never enrich/email non-people or shared inboxes:
- **`isLikelyPersonName(name, publication)`** (lines 18-35): rejects names with digits, commas/slashes, `<2` or `>4` tokens, any token in `NON_PERSON_WORDS` (inc, llc, media, news, editorial, staff, team, author, editor, director, engineer, manager, product, marketing, etc.), or a name that equals/overlaps the publication name. Called at the very top of `processOne`, so a non-person is a free instant skip.
- **`isRoleEmail(email)`** — delegates to the **canonical** detector `src/lib/email/roleEmail.ts`, so the finder path and the storage/send path agree. It matches exact local-parts (press, info, contact, editor, tips, no-reply, git, api, submissions, …) **and** compound/contains stems (`pressinquir`, `brandlicens`, `newsroom`, `noreply`, `submiss`, `inquir`, `editorial`, `customercare`, …). This catches compound addresses the old exact-token set missed (e.g. `pressinquiries@medium.com`).
- `isGuessSource(source)` / `isGuess(source)` — a "guess" = `pattern` or `pattern-catchall` (constructed, not SMTP-verified). Sourced + `pattern-verified` are not guesses.

Role-email enforcement happens in **three** places: `scrapePageSignals` drops them from scraped emails; the cascade/loop reject a role email as the final result; and `upsertContact` (queries.ts:120-133) refuses to store a `mailto` that is a role email (returns a sentinel `{ id:"", skipped_role_email:true }`) — so even a bug upstream can't persist `press@`.

### Domain email-pattern inference — `src/lib/enrich/patternInfer.ts`

Free, no API. `detectPattern(known, minAgree=2)` tallies which of 10 named patterns (`first.last`, `first_last`, `firstlast`, `flast`, `f.last`, `first`, `last`, `lastfirst`, `first.l`, `firstl`) matches the known (name,email) pairs on a domain. Requires the winning pattern to have **≥2 agreeing emails AND cover ≥60%** of considered emails — otherwise returns null (too risky). `resolveDomainPattern` prefers an inferred pattern, else a hardcoded fallback in `KNOWN_PATTERNS` (`fastcompany.com`→`flast`, `ibm.com`→`flast`). `getKnownEmailsByDomain` pools every author on the **same registrable domain** (ibm.com subdomains unified) and double-checks both the publication host and the email's domain match exactly (so a Fast Company writer's personal gmail can't poison inference, and `%ibm.com` can't leak `notibm.com`). Suffix tokens (phd, jr, dr, …) are stripped before tokenizing.

### Domain Rating — `src/lib/enrich/domainRating.ts`

`fetchDomainRating(host)` → Ahrefs free public endpoint `/v3/public/domain-rating-free?target=…&output=json`. Sends `Authorization: Bearer <AHREFS_API_KEY>` if set (source `ahrefs-free-key`), else unauthenticated (`ahrefs-free`). Returns `{ dr, source }` or null on any non-OK/parse/network error. **Consumer:** `pipeline/run.ts:697-705` fetches DR once per domain during discovery (only when `domainRow.dr == null`), best-effort, to feed the DR≥50 qualification filter. Not surfaced in the Email Finder UI. Traffic + US-share (filters 2 & 3) come from a paid Ahrefs plan and are enriched elsewhere — this module owns DR only.

---

### Key checks & validations (summary)

1. **Single active run** — `checkRunning()` (durable Redis) blocks a concurrent fresh start (`{alreadyRunning:true}`).
2. **Person-name gate** — `isLikelyPersonName` before any API spend.
3. **Role-email rejection** — at scrape, at result, and at storage (`upsertContact`).
4. **Email syntax** — `EMAIL_RE` in both the loop and refind.
5. **LinkedIn slug/name match** — `findLinkedin.ts` only accepts a `/in/<slug>` whose slug contains a ≥3-char token of the author's name, so a wrong-person profile is never fed to Blitz.
6. **Pattern safety** — `detectPattern` requires ≥2 agreeing + ≥60% coverage; registrable-domain scoping prevents cross-domain poisoning.
7. **Verify-once-per-domain** — Reoon verdict cached; only `safe`/`catch_all` cached (invalid/unknown re-checked, but never blocks returning the guess).
8. **Stale/orphan run detection** — 60s heartbeat threshold unsticks dead runs.
9. **Contact upsert dedupe** — `onConflict:"author_id,type,value", ignoreDuplicates:true` (queries.ts:128) so re-runs don't create duplicate contacts.

---

### Flows

**A. Bulk email-finding run (happy path)**
1. User picks mode=Emails, a campaign (or All), optionally "Brand new only", clicks **Find Emails**.
2. `POST /api/enrich/run` → not already running → `getAuthorsNeedingEmail` builds the target list (authors with a `primary_domain_id`, no `mailto` contact, in-campaign, optionally never-attempted).
3. `startEnrich` + `setEnrichTargets` + immediate `snapshotToRedis`; loop kicks off in `after()`; response `{started:true}`.
4. Client starts polling `/api/enrich/status` every 2s; activity rows stream per-person steps.
5. For each author: person-name gate → `resolveEmailCascade` (stored LinkedIn? → post scan → socials → web search → Blitz → AI scan → verified pattern) → any discovered LinkedIn upserted → `markEmailSearchAttempted` → valid email upserted as `mailto`.
6. On Vercel, if 200s elapse with work left, the loop hands off to a fresh invocation via QStash (`continue:true`), resuming at `doneCount()`; repeats until done.
7. On finish: `finishEnrich` → `saveEnrichmentRun` → `clearEnrichTargets`. Client sees `running:false`, stops polling, refreshes pending + run history, shows per-source breakdown.

**B. LinkedIn-finding run** — same shape but `getAuthorsNeedingLinkedin` targets + `resolveLinkedinCascade` (no Blitz/email), storing `linkedin` contacts. Higher hit-rate; intended as a first pass so a later email run can convert LinkedIns via Blitz cheaply.

**C. Stop** — user clicks Stop → `POST /api/enrich/stop` → `requestAbort` sets in-memory + Redis flag → loop breaks before the next author (current lookup finishes first) → run finalizes and is saved.

**D. Single-author re-find** — from the ProspectDrawer, click **Re-find email** → `POST /api/authors/{id}/refind` → full cascade synchronously (fresh caches, not the buffer) → stores email/LinkedIn → returns steps + result rendered inline. (Does not touch run history or `email_search_attempted_at`.)

**E. Replaying history** — click a run in Run history → `openRun` stops live polling, loads `/api/enrich/runs/{id}` into the same activity UI; "Back to live" returns to the current/last live run.

**F. Discard / Emailed toggles** — in the drawer, Discarded → `PATCH …/discard` (hides from all workflows); Emailed → `PATCH …/contacted` (override contacted state: true/false/null).

---

### Edge cases & cautions

- **Two enrichment paths, easily confused.** The Email Finder uses `cascade.ts`; Hunter/`emailCandidates`/`resolve.ts`/`guessAndVerify` are only reachable via discovery-time enrichment gated behind `ENRICH_ON_DISCOVERY=true` (off by default). Editing Hunter or `patterns.ts` will **not** change Email Finder behavior.
- **Pattern guesses are amber, not green.** `pattern` and `pattern-catchall` sources are **unverified guesses** — the constructed local part could be wrong for that individual even if the domain pattern is right. `pattern-catchall` is especially weak: the domain accepts *any* address, so Reoon "valid" is meaningless (hence score 65). Only `pattern-verified` (SMTP-safe) is trustworthy among pattern sources. The cascade **always returns a pattern email when a pattern exists**, even on an `invalid`/`unknown` per-person verdict — so a "found" pattern email is never a guarantee the mailbox exists.
- **"couldn't complete" (error) ≠ "no email exists".** When a provider (Blitz/Reoon/web-search/AI) fails, the person is marked `error` with issues, surfaced separately as "API issue(s)". A bad API run must not be read as genuine absence — re-run to retry. This distinction is the whole reason `onIssue` exists.
- **Blitz media hit-rate is low.** The domain→company→employees chain works for corporates but frequently fails for media orgs / freelancers whose "company" isn't a clean LinkedIn company page or who aren't in the employee list (see MEMORY: "low hit rate for media orgs"). Many authors will fall through to the pattern guess or a miss.
- **Cooperative stop, not instant.** Stop only takes effect between authors; the in-flight lookup (which can include a 20s Blitz/Reoon/AI timeout and a 50-post scan) completes first.
- **Caches don't survive chunk hand-off.** `patternCache`/`domainVerify` are per-`enrichLoop` invocation. A QStash continuation starts with empty caches, so the same domain may be re-inferred/re-verified across chunks (extra Reoon calls, minor waste).
- **`markEmailSearchAttempted` is bulk-only.** Refind does not set it. So "Brand new only" still treats a refind-searched author as brand-new. Also, an author with a `mailto` contact is excluded from targets entirely, so re-running never re-checks someone who already has *any* email (even a stale guess) — to re-find, you must delete the contact or use the drawer's refind.
- **Stale-run window.** If the serverless process dies mid-run without QStash configured, the run sits `running:true` in Redis for up to 60s before the heartbeat-staleness check frees it; during that window a new start is blocked (`alreadyRunning`).
- **No auth on enrich/pending/status/runs routes.** These routes have no explicit permission check in-file; they rely on the app's proxy/deployment gating. A maintainer exposing them publicly would leak prospect counts and run data.
- **Local SMTP verify rarely works on serverless.** The `deep-email-validator` fallback in `verify.ts` needs outbound port 25, which is blocked on most hosts (incl. Vercel). Without a `REOON_API_KEY`, pattern verification effectively degrades to `unknown` → every pattern email is tagged plain `pattern` (score 55).
- **Web-search provider precedence is fixed.** `searchProvider()` returns the first configured key in order Tavily→Google→Brave→Serper; you can't choose. Tavily uses a rotating key pool that marks keys exhausted on 402/403/429/432 — an all-exhausted pool silently returns no hits (recorded as a "web search" issue, so LinkedIn discovery just fails softly).
- **AI-scrape only reads 3 fixed pages** (`/contact`, `/about`, homepage) and truncates page text to 6000 chars; an email on an author bio page elsewhere won't be found by this step. It also rejects role emails and anything not matching `EMAIL_RE`.
- **`getKnownEmailsByDomain` over-fetches with `%<domain>` ilike then filters in memory**, capped at 500 rows — on a very large domain some known emails could be missed by the cap, weakening pattern inference (rare).
- **Contacted state has shared-inbox propagation.** `isAuthorContacted`/`getContactedAuthorIds` treat an inbox as contacted across *all* authors who share that mailto address — so many scraped authors pointing at one editorial inbox are all marked contacted once any is emailed. This is intentional (don't hit the same inbox twice) but can surprise a maintainer expecting per-author state. Manual override (`contacted_override` true/false) wins over derived history.
- **`ProspectDrawer` optimistically flips toggles before the PATCH resolves** (discard/emailed) — a failed request leaves the UI out of sync with the DB until reload.

---

## Link Audit & Page Health (Indexing)

This area is the app's **technical-SEO hub**. It lives at the route `/link-audit` (nav entry "Link Audit", `Unlink` icon — `src/components/layout/Sidebar.tsx:42`) and is a single page split into **two tabs**: **Broken Links** and **Page Health**. Both tabs share one Slack webhook, one daily-cron trigger, and the same session/`CRON_SECRET` auth convention.

- Page shell: `src/app/link-audit/page.tsx`
- Broken Links tab component: `BrokenLinksPanel` (same file, lines 35–401)
- Page Health tab component: `PageHealthPanel` (`src/components/pagehealth/PageHealthPanel.tsx`)

### Purpose

**Broken Links** runs a daily bot crawl of every page in imagine.art's sitemap, reads every link on every page, and flags links that are dead — hard 404/410s, "soft" 404s (pages that return HTTP 200 but are really a not-found page), and deep links that now redirect to a homepage. It groups findings by broken link, attributes each to the page's author, and posts a Slack digest (with automatic @-mentions of authors when a Slack bot token is configured).

**Page Health (Indexing)** answers "can Google and AI search tools actually see these pages?" It crawls a bounded, template-stratified sample of the live site, fetches each URL **twice** (raw HTTP with no JavaScript vs. headless-Chromium rendered), diffs the two to detect JS-gated rendering, runs an indexability gate battery, measures Core Web Vitals (CrUX field p75 via PageSpeed Insights), classifies every problem into a plain-English fix routed to the right team, and can open a real GitHub PR, a real Linear ticket, or post a Slack digest — but only on an explicit human click. The scan itself is side-effect-free (no site changes, no external dispatch).

---

### UI walkthrough

#### Tab bar (`src/app/link-audit/page.tsx:405-426`)

Two buttons under a bottom border: **Broken Links** and **Page Health**. Local state `tab` (`"links" | "health"`, default `"links"`) toggles which panel renders. Active tab gets a violet underline; the whole thing is wrapped in `max-w-5xl mx-auto` padding.

#### Broken Links tab — `BrokenLinksPanel`

State loaded on mount (`useEffect`, lines 68–78): `GET /api/link-audit/status` (running flag, live progress, run history), `GET /api/link-audit/findings` (findings for the most recent completed run), `GET /api/link-audit/ignore` (ignore list), `GET /api/link-audit/settings` (webhook/bot-token configured flags + manual Slack map).

**Header (lines 168–196)**
- Title "Broken links" + subtitle describing the daily crawl.
- **Send test to Slack** button (`sendTest`, lines 108–114): `POST /api/link-audit/test-slack`. Disabled while testing OR when `hasWebhook === false` (tooltip tells you to add a webhook first). Toast reports whether it sent the latest run's real digest or a plain hello.
- **Stop** button (lines 185–190): only shown while `running`. Calls `stopRun` (`POST /api/link-audit/stop`), toasts "Stopping — finishes the current page, then halts (partial findings are kept)", then re-loads status after a 4 s delay. Styled red.
- **Run now** button (lines 191–194): calls `runNow` (`POST /api/link-audit/run` with body `{}`). Disabled while `starting || running`. On `{started:true}` toasts "Audit started — N pages queued"; on `{alreadyRunning:true}` toasts info; otherwise error. Label switches to "Running…" with a spinner while a run is live.

**Live progress panel (lines 199–222)** — shown only when `running && progress`:
- "Crawling — X/Y pages" with a spinner and a progress bar computed as `pagesChecked / max(pagesTotal,1)`.
- A one-liner: `linksChecked` unique links checked · **N broken** (red) · N unreachable (not counted as broken) · "keeps running if you close this tab".
- A **verbose per-page log** (max-height scroll box, newest at the bottom via `flex flex-col-reverse`). Lines containing "BROKEN" render red, "failed" amber, else muted.
- While `running`, a 4 s polling timer (lines 81–88) re-fetches status and (if `progress.runId`) findings, so progress and fresh findings stream in.

**Findings section (lines 225–280)**
- Heading "Broken links" (with "— run <date>" when viewing a specific historical run) and a badge showing the broken-link **group** count (green border when 0, red otherwise).
- **Empty state**: if any run is `completed` → "No broken links in this run. 🎉"; otherwise → "No completed runs yet — hit Run now, or wait for the daily cron."
- Otherwise a list of `<details>` groups, one per unique broken `link_url` (grouping done client-side, lines 152–163). Each summary row shows: expand chevron, the broken link (opens in new tab, red), a reason badge (`REASON_LABEL` maps `http-404`→"404", `http-410`→"410 gone", `soft-404`→"soft 404", `homepage-redirect`→"→ homepage"), "on N pages", and an **Ignore** button.
  - **Ignore** (`ignoreLink`, lines 140–145): optimistically removes the link's findings from the list and adds it to the ignore list, then `POST /api/link-audit/ignore {link}`. Toasts "Ignored — this link won't be checked or reported again."
  - Expanded body shows the AI-written **location hint** (violet, `MapPin` icon) if present, then one line per affected page: the page path (links out), "— by <author>" (or italic "no author on file"), the link/anchor text, and — only when there's no location hint — an italic clipped context snippet.

**"Couldn't verify" section (lines 283–301)** — shown only when there are unreachable groups. Lists links whose reason is `"unreachable"` (bot-blocked/timeout/odd status). Each row shows an index, the link (amber), `HTTP <status>` or "timeout", and "on N pages". Explicitly labeled "not counted as broken, worth a quick manual check".

**Run history (lines 304–325)** — list of the last 15 runs (from status endpoint). Each row is a button that loads that run's findings (`loadFindings(r.id)`), with a status icon: `completed`→green check, `failed`→red X, `stopped`→amber square, else (running)→blue clock. Shows "X/Y pages · N links · N broken" and a "slack ✓" badge when `slack_posted_at` is set. The currently-viewed run is highlighted.

**Slack settings (lines 328–383)**
- **Webhook** input (`type="password"`), with a badge: green "configured" or amber "not set" (driven by `hasWebhook`). Placeholder tells you to paste a new `https://hooks.slack.com/…` URL. Note: "Stored encrypted; never displayed back. Leave blank to keep the current one."
- **Bot token** input (`type="password"`, `xoxb-…`), badge: green "configured — auto-matching on" or amber "not set — names shown as plain text". Explains it enables fuzzy auto-matching of author names to workspace members (needs `users:read` scope).
- **Manual overrides** textarea: one `Name = U0123ABCDEF` per line, "wins over fuzzy matching". Parsed by `saveSettings` (lines 116–136) with regex `/^\s*(.+?)\s*=\s*([A-Z0-9]+)\s*$/` — only well-formed lines are kept.
- **Save settings** button: `POST /api/link-audit/settings` with `{slackMap, webhook?, bot_token?}` (webhook/token only included if non-blank). On success clears the input fields and flips the configured badges; if the server reports `directoryUsers`, toasts "found N workspace members for auto-tagging."

**Ignored links (lines 386–398)** — shown only when the list is non-empty. Lists each ignored link with an **un-ignore** link (`unignoreLink`, lines 146–150 → `DELETE /api/link-audit/ignore?link=…`), toasting "Un-ignored — it'll be checked again next run."

#### Page Health tab — `PageHealthPanel`

On mount, `loadHistory()` fetches `GET /api/indexing/history`.

**Header (lines 283–292)** — "Page Health Check" title + subtitle emphasizing "Nothing is changed on your site; you decide what to send to the team."

**Controls (lines 295–346)**
- **"What should I check?"** — two-button toggle: "My most important pages" (`scope="important"` → sends `moneyFirst:true`) vs. "A sample of the whole site" (`scope="sample"`). Default `important`.
- **"How many pages"** — numeric input `count`, min 1, max 40, default 15. (The `/run` route re-clamps to 1–40.)
- **Check my pages** button (`run`, lines 248–272): `POST /api/indexing/run` with `{limit:count, device, template||undefined, moneyFirst: scope==="important"}`. Sets `running`, clears prior report/runId. On `{ok:true, report}` sets the report, toasts "Checked N pages.", reloads history; else error toast.
- **Advanced options** `<details>`:
  - **"Speed measured for"** select — `mobile` (label "Phone", default) or `desktop`.
  - **"Only one page type"** text input `template` (e.g. `apps/[slug]`) — optional template filter, sent only if non-empty.

**While running (lines 348–353)** — a muted spinner line: "Opening each page the way Google sees it (twice — with and without code) and measuring speed."

**When no report is loaded:**
- If `history.length >= 2`, a **Trends** card (lines 215–228) renders two sparklines ("Pages hidden from search" = `js_gated_count`, "Total issues found" = `issues_count`) over the last N checks. `TrendCard` (lines 193–213) shows the latest value, a dependency-free SVG `Sparkline`, and a delta ("↓ N since your first check", green when improved since lower-is-better, red when worse, or "no change").
- If `history.length > 0`, a **Past checks** list — each row loads that run via `openHistoryRun(id)` → `GET /api/indexing/history/{id}`. Shows the timestamp, "N pages checked", "N hidden from search" (amber, when >0), and the creator email.

**Report view (`Report` component, lines 382–656)** — rendered when a report is loaded:

- **Plain-English headline** (lines 423–436): if `flag+block === 0` → green "All N pages checked look healthy"; else "We checked N pages. M need attention — including K that Google & AI search may not be able to see. Start with the What to fix tab."
- **PageSpeed warning** (lines 439–444): if any note mentions "PAGESPEED", shows an amber banner about adding a free PageSpeed key.
- **Stat tiles** (lines 447–452): Pages checked, Healthy (`verdicts.pass`), Need attention (`flag+block`), Hidden from search (`counts.jsGated`).
- **Five tabs** (`Tabs`, default `fix`):
  1. **What to fix** (`report.routing.length` in the label; lines 464–520) — the hero. Empty state (no issues) → "Nothing to fix… 🎉". Otherwise one card per routing preview showing: a priority badge (`PRIORITY_UI`: p0="Urgent" red, p1="High" amber, p2="Normal" grey), a plain-English title + "why" (from the `EXPLAIN` dictionary keyed by the gate reason; `http_status=` reasons get a dynamic title), "Affects N pages", the fix text (`Wrench` icon), the owning team (`OWNER_UI`: webdev="Web team", seo="SEO team", content="Content team"), and a collapsible "Show affected pages" list (first 30 URLs). The action button is **"Draft the fix (pull request)"** for `kind==="pr"` or **"Create a ticket"** for `kind==="ticket"** (`dispatchRouting`, lines 388–406 → `POST /api/indexing/pr` or `/api/indexing/ticket` with `{preview, runId}`). On success shows a link "Fix drafted / Ticket created — open it" (the PR/issue URL) and toasts the PR number or Linear identifier; on error shows the message inline.
  2. **All pages** (lines 522–571) — one card per analyzed URL: a verdict badge (`VERDICT_UI`: pass="Healthy" emerald, flag="Needs attention" amber, block="Serious problem" red), the path (links out), an "important" badge for money pages, and the human-worded predicted Google outcome (`googleResult`). A second line shows how the page loads (`renderUI`: ssr="Loads instantly", mixed="Some content needs code", client-rendered="Content loads via code", unknown="Couldn't check") plus, if GSC is configured, "Google says: <coverageState>". Issue chips (each a hover-tooltip with the plain explanation) and a red "Couldn't load this page (error)" line when applicable. If `!report.gscConfigured`, a tip suggests connecting Google Search Console (`docs/GSC_SETUP.md`).
  3. **Speed** (lines 573–605) — per-template CWV cards. Each shows the template + representative URL. When `hasField`, a 3-column grid of Loading speed (LCP), Responsiveness (INP), Visual stability (CLS): value (ms except CLS) colored by rating (`ratingClass`: good=emerald, needs_improvement=amber, poor=red, unknown=muted) with a "✓ good / could be better / poor" tag and a bulleted diagnosis list. When no field data → "Not enough real-visitor data yet (error)".
  4. **Page types** (lines 607–633) — a table grouped by template: "Page type" (with "important" badge for money templates), "How it loads" (render mode + "(K/N hidden)" in red when js-gated pages exist), "Pages checked" (`urlCount`), and "Health" (green "all healthy" or amber "M need attention").
  5. **Share** (lines 635–652) — a `<pre>` of `report.slackPreview` and a **Share to Slack** button (`postSlack`, lines 408–418 → `POST /api/indexing/slack` with `{text: report.slackPreview, runId}`). On success shows "Shared"; errors shown inline.

---

### API routes / server logic

**Shared auth convention** (link-audit `/run`, indexing `/run`, `/cron`, `cron/daily`): if `CRON_SECRET` is unset → allow everything (`return true`). Otherwise accept `Authorization: Bearer <CRON_SECRET>`, or `?key=<CRON_SECRET>`, or any signed-in NextAuth session (`auth()`). The `/pr`, `/ticket`, `/slack` indexing routes and the indexing history routes are **session-only** (no `CRON_SECRET` path). Sessions require a Google login on an allowed domain (`auth.ts`, default `imagine.art`).

#### Link Audit routes

**`POST` / `GET /api/link-audit/run`** (`src/app/api/link-audit/run/route.ts`, `maxDuration = 300`)
- `GET` simply delegates to `POST` (Vercel cron issues GET).
- Auth via the shared `authorized()`. On failure → `401 {error:"unauthorized"}`.
- Body parsed with a `.catch(() => ({}))` fallback.
- **Continue branch** (`body.continue`): if no Redis state → `{continued:false, reason:"nothing to continue"}`; else schedules `processAuditChunk()` via `after()` and returns `{continued:true, index, pagesTotal}`. This is the QStash chunk hand-off path.
- **Fresh start**: acquires a 60 s start lock `lock:linkaudit:start` (guards concurrent *starts* only). If not acquired → `{started:false, alreadyRunning:true}`. Inside the lock: if existing Redis state has a heartbeat < 10 min old → treat as active, return `{started:false, alreadyRunning:true, index, pagesTotal}`; otherwise `startAudit()` (fetch sitemap, create `link_audit_runs` row, init state), schedule `processAuditChunk()` via `after()`, return `{started:true, runId, pagesTotal}`. Errors → `500 {error}`. The lock is always released in `finally`.

**`GET /api/link-audit/status`** (`status/route.ts`) — no explicit auth. Returns `{running, progress, runs}`. `running` is true iff Redis state exists AND `Date.now() - state.updatedAt < 10*60_000`. `progress` maps the Redis `AuditState` (runId, pagesChecked=index, pagesTotal, linksChecked, broken, unreachable, log). `runs` = last 15 rows of `link_audit_runs` ordered by `started_at desc`.

**`GET /api/link-audit/findings`** (`findings/route.ts`) — no explicit auth. `?run_id=` optional; when omitted, resolves to the most recent `completed` run. If no run exists → `{runId:null, findings:[]}`. Otherwise returns up to 500 findings for that run ordered by `link_url`.

**`GET/POST/DELETE /api/link-audit/ignore`** (`ignore/route.ts`) — no explicit auth.
- `GET` → `{ignored: [...]}`.
- `POST {link}`: 400 if `link` missing/non-string. Adds to the Redis ignore list AND **deletes** all `link_audit_findings` rows with that `link_url` (purges it from every run immediately). Returns `{ok:true, ignored}`. Errors → `500`.
- `DELETE ?link=`: 400 if missing. Removes from the ignore list. Returns `{ok:true, ignored}`. (Does NOT re-create findings — the link is simply eligible again next run.)

**`GET/POST /api/link-audit/settings`** (`settings/route.ts`) — no explicit auth.
- `GET` → `{hasWebhook, slackMap, hasBotToken}`. Secrets never returned, only booleans.
- `POST {webhook?, bot_token?, slackMap?}`:
  - `webhook` (if non-blank) validated against `^https://hooks\.slack\.com/` → else `400`. Stored encrypted.
  - `bot_token` (if non-blank) validated against `^xox[bp]-` → else `400`. Stored encrypted, then **immediately validated** by calling `fetchSlackUsers()`; if it returns 0 users, the token is rolled back via `clearBotToken()` and returns `400` ("needs the users:read scope … auto-tagging stays off"). On success returns `{ok:true, directoryUsers:N}` (and saves `slackMap` inside this branch too).
  - Bare `slackMap` (no secrets) is saved and returns `{ok:true}`.
  - Errors → `500`.

**`POST /api/link-audit/stop`** (`stop/route.ts`) — no explicit auth. Sets the durable Redis stop flag (`requestAuditStop()`), returns `{stopping:true}`. The running chunk checks this flag before every page on whatever instance is executing.

**`POST /api/link-audit/test-slack`** (`test-slack/route.ts`) — no explicit auth. Finds the latest `completed` run. If one exists → re-posts its **real digest** (`postAuditDigest`); else posts a plain hello message via `postToSlack`. On Slack failure → `500 {ok:false,error}`. Then a **tag test**: collects authors from the latest run's findings + a hard-coded `SAMPLE_AUTHORS` list (Tooba Siddiqui, Saba Sohail, Areeba Imran, Arooj Ishtiaq, Ryan Hayden, Umaima Shah, Sameer Sohail), resolves them to member IDs, and posts a second message listing "• Name → @mention" or "→ no match in workspace". Returns `{ok:true, usedRealDigest, botConfigured, matched, tested}`.

#### Indexing routes

**`POST /api/indexing/run`** (`run/route.ts`, `maxDuration = 300`) — shared auth. Body clamped: `limit = min(max(limit||20,1),40)`, `device = desktop|mobile(default)`, `template` (trimmed, optional), `moneyFirst = body.moneyFirst === true`. Calls `runIndexingReport(...)`, persists a summary via `saveRun(report, session.email)`, returns `{ok:true, report, runId}`. Errors → `500 {ok:false,error}`. `finally` always calls `closeIndexingBrowser()` so a local dev server doesn't hold Chromium between runs. **The scan makes no external side effects** — PR/ticket/Slack dispatch only happens via the separate endpoints on an explicit click.

**`POST` / `GET /api/indexing/cron`** (`cron/route.ts`, `maxDuration = 300`) — shared auth. `?dry=1` runs + persists WITHOUT posting to Slack. Runs `runIndexingReport({limit:25, moneyFirst:true, device:"mobile"})`, `saveRun(report, "nightly-cron")`. Builds a header: `:rotating_light:` when `p0 > 0` (louder alert for money-page P0), else `:sunrise:`. Unless dry, gets the shared link-audit webhook; if none → `slackError` set (no post). Posts `header + report.slackPreview` to the webhook (15 s timeout), records the outcome via `logDispatch({kind:"slack", dispatchedBy:"nightly-cron"})`. Returns `{ok:true, runId, analyzed, jsGated, p0, issues, slackPosted, slackError, dry}`. Errors → `500`.

**`GET /api/indexing/history`** (`history/route.ts`) — **session-only** (`401` without a user). `?limit=` clamped to max 100 (default 20). Returns `{ok:true, runs}` (summary columns only, newest-first).

**`GET /api/indexing/history/[id]`** (`history/[id]/route.ts`) — **session-only**. Loads the full `report` JSONB for that run. Not found → `404 {ok:false,error:"not found"}`.

**`POST /api/indexing/pr`** (`pr/route.ts`, `maxDuration = 60`) — **session-only** (write action, deliberate human click). Body `{preview, runId}`. If `preview` missing or `preview.kind !== "pr"` → `400`. Calls `openProposalPr(preview, now)`, logs the dispatch (kind `pr`, `dispatchedBy: session.email`), returns `{ok:true, pr}`. On failure logs an `error` dispatch and returns `500 {ok:false,error}`.

**`POST /api/indexing/ticket`** (`ticket/route.ts`, `maxDuration = 30`) — **session-only**. Body `{preview, runId}`; requires `preview.kind === "ticket"` → else `400`. Calls `createLinearIssue(preview)`, logs dispatch, returns `{ok:true, issue}`. On failure logs error + `500`.

**`POST /api/indexing/slack`** (`slack/route.ts`, `maxDuration = 30`) — **session-only**. Body `{text, runId}`; 400 if `text` missing. Reuses the **link-audit webhook** (`getWebhook`); if none configured → `400`. Posts `{text}` (15 s timeout); non-OK Slack response → logs error + `502 {error:"Slack HTTP …"}`; network throw → logs error + `500`. Success → logs ok + `{ok:true}`.

#### Daily cron orchestration

There is **no per-feature cron entry in `vercel.json`** — the only cron there is `/api/emails/process` at `0 13 * * *`. The link-audit + page-health daily work is fanned out from **`POST/GET /api/cron/daily`** (`src/app/api/cron/daily/route.ts`, `maxDuration = 300`), which (per its comment, to fit Vercel Hobby's 2-cron limit) triggers, in sequence, using `?key=<CRON_SECRET>`:
1. `/api/link-audit/run` (returns fast; work continues via `after()`+QStash),
2. `/api/indexing/cron` (nightly page-health scan → its own Slack digest via the shared webhook),
3. `/api/digest/daily`, `/api/enrich/run` (`only_new:true`),
4. `/api/notifications/check` (post-response via `after()`).
Returns `{ok:true, audit, pageHealth, digest, finder, notifications}`. This route must itself be invoked by an external scheduler (it is not wired into the shown `vercel.json`).

---

### Core library logic

#### Broken-link crawler — `src/lib/linkaudit/run.ts`

Constants: sitemap `https://www.imagine.art/sitemap.xml`, `MAX_PAGES=2000`, `MAX_LINKS_PER_PAGE=300`, `MAX_PAGES_PER_BROKEN_LINK=5` (caps finding rows for a site-wide dead nav/footer link), `LINK_CONCURRENCY=8`, `CHUNK_BUDGET_MS = 210_000` on Vercel else `Infinity`. Long-job shape mirrors the discovery pipeline: chunked with a time budget, state in Redis, auto-continued via QStash, results in Postgres, Slack digest on completion.

- **`fetchSitemapUrls`** (121–134): BFS through a sitemap index (up to 50 nested sitemaps), collecting `<loc>` URLs up to `MAX_PAGES`.
- **`extractLinks`** (140–190): regex-scans `<a href>` (max 300/page), skips `#/mailto:/tel:/javascript:/data:/blob:`, resolves relative URLs, keeps only `http(s)`, strips the hash, dedups by URL while recording up to 4 structural **occurrences** each (zone via `zoneAt` = nav/header/footer/aside/main; nearest heading above via `nearestHeadingAbove`; anchor text). Captures a ±400-char text window around the match, aggressively scrubbing half-open tags and `<script>` fragments; if the surviving context still looks like JavaScript, it's dropped entirely.
- **`describeOccurrences`** (91–100): builds the human "where is this link" sentence purely from DOM landmarks (accurate by construction, no AI).
- **`harvestCardAuthors`** (195–207) / **`extractPageAuthor`** (213–226): imagine.art blog cards pair a `/blogs/*` URL with an author (avatar `src` containing "author" + a name `<p>`); a page's own byline is read from an author-bio box or a byline strip, falling back to `<meta name=author>` or JSON-LD `author.name`.
- **`aiExtractAuthor`** (284–313): OpenRouter/`anthropic/claude-haiku-4-5` fallback — fires **only** when deterministic byline patterns miss **and** the URL contains `/blogs/`. Sees only the top+bottom ~3500 chars of stripped text; validates the reply looks like a real name. No-op if `OPENROUTER_API_KEY` is missing/<20 chars.
- **`checkLink`** (337–390): the verdict engine.
  - Tweet-embed hosts (`t.co`, `pic.twitter.com`, `pic.x.com`, `platform.twitter.com`) always return `ok` (they 404 to bots but render in a browser).
  - Fetch fails → `unreach`.
  - 404/410: only reported as `404`/`410` if the body **also** looks like an error page (`< 2048` chars, or titleless, or `NOT_FOUND_RE` matches title/h1); otherwise a "healthy-shell 404" (SPA that ships a working app under a 404 status) → `unreach`.
  - Any non-200 (bot-block, rate limit, 5xx) → `unreach` (never "broken" — false-positive avoidance).
  - Deep link whose final URL is the homepage root → `home`.
  - `NOT_FOUND_RE` in title/h1 → `soft`.
  - Social/bot-walled hosts (`SOCIAL_SKIP`: reddit, instagram, facebook, x, twitter, linkedin, tiktok, youtube, threads, discord, pinterest, medium) → `ok` (can't inspect a 200 further).
  - **Fingerprint soft-404** (`getFingerprint`, 261–279): probes a garbage URL with the same host + first path segment; a 200 probe is only "usable" if it differs from the segment-root page (guards against catch-all echoes that would flag live pages, e.g. `imagine.art/video/garbage` returning the `/video` page). Matching title (or matching h1 when both titleless, or ~2% byte-identical when both empty) → `soft`.
- **State** in Redis: `linkaudit:state` (AuditState, 24 h TTL, heartbeat = `updatedAt`), `linkaudit:checked` (per-URL verdict cache for the run), `linkaudit:fp` (fingerprint cache), `linkaudit:stop` (durable stop flag, 1 h TTL). Log capped at 120 lines.
- **`startAudit`** (441–459): fetches sitemap, inserts a `running` `link_audit_runs` row, clears old state, inits AuditState, clears the stale stop flag.
- **`processAuditChunk`** (464–647): the worker.
  - Skips internal links that are themselves sitemap pages (alive by definition) and team-ignored links (fetched once via `getIgnoredLinks()`).
  - Before every page, checks the durable stop flag → if set, marks the run `stopped`, saves partial counts, clears state+stop, returns.
  - Per page: fetch (15 s), harvest card authors (own-byline entries are prefixed `!` so a page's own byline can never be overwritten by another page's card), extract + check links at concurrency 8, and **upsert findings** to `link_audit_findings` (`onConflict: run_id,page_url,link_url`, `ignoreDuplicates`). Broken verdicts stamp `location_hint = describeOccurrences(...)`; unreachable rows are stored with `reason:"unreachable"`.
  - Persists state/checked/fp and updates the run row every 5 pages.
  - On budget exhaustion with pages left → `qstashPublish("/api/link-audit/run", {continue:true, auto:true})` and returns.
  - On completion (**Finalize**): backfills authors onto findings from the now-complete card map (own byline wins), then computes AI **location hints** (one Haiku call per unique broken link, capped at 30, persisted), marks the run `completed`, and posts the Slack digest (`postAuditDigest`). Digest failure never fails the run.

#### Broken-link Slack — `src/lib/linkaudit/slack.ts`

- Redis keys: `linkaudit:webhook` (encrypted), `linkaudit:slackmap` (JSON name→ID), `linkaudit:bottoken` (encrypted), `linkaudit:slackusers` (12 h user-directory cache).
- **`getWebhook`** falls back to `process.env.SLACK_BROKEN_LINKS_WEBHOOK`. **`setWebhook`/`setBotToken`** throw if Redis isn't configured. `setBotToken` also busts the user cache.
- **`fetchSlackUsers`** (83–113): paginates `users.list` (up to 10×200), drops deleted/bots/USLACKBOT, collects each member's `real_name`/display/username, caches 12 h. Empty if no token.
- **`fuzzyMatchUser`** (133–151): three tiers (exact normalized name → all author tokens present in the user's name → edit distance ≤ 2 with length delta ≤ 3). **Ambiguity (two users match a tier) returns null** — never ping the wrong person. **`resolveAuthorIds`**: manual map wins, then fuzzy.
- **`aiLocateFinding`** (201–231): Haiku one-phrase "where is this link" fallback (used live only for older runs lacking a persisted `location_hint`).
- **`renderFindings`** (238–279): groups by link, splits into "Authored" then "No author" with continuous numbering; nothing truncated. Author names become `<@ID>` when resolved else plain text. Prose context is quoted only when `isProseContext` passes (≥8 words, ≥50 chars, <50% capitalized tokens — filters nav/footer label soup).
- **`chunkForSlack`** (283–292): splits long digests into ~3500-char posts on line boundaries. **`haikuIntro`** writes a 1–2 sentence intro (plain fallback on failure).
- **`postAuditDigest`** (368–384): composes + posts all chunks sequentially (continuation prefix on posts 2+), stamps `slack_posted_at` on success. **`composeAuditDigest`** filters out `unreachable` findings, resolves author @-mentions, and returns "All clean today" when nothing broke.

#### Indexing pipeline — `src/lib/indexing/*`

- **`discover.ts`**: reads `sitemap.xml` (one level of index nesting, ≤10 child sitemaps, cap 5000), parses `robots.txt` into a disallow-prefix matcher for the global `User-agent: *` group. **Stratified round-robin sampling** across templates so a small limit spans page types; `moneyFirst` forces money pages in first. If the sitemap is empty, falls back to a **seed list** of non-wildcard money-page patterns. Notes are surfaced to the report.
- **`fetchRendered.ts`**: `fetchRaw` uses `redirect:"manual"` (so a URL that itself 3xx's is caught as `isRedirect`) and only reads a body for 2xx. `fetchRendered` requires `PLAYWRIGHT_ENABLED === "true"`, uses a **leak-safe shared Chromium singleton** (one browser, a page per URL), `waitUntil:"domcontentloaded"` + a fixed 2500 ms settle (not `networkidle`). `playwrightEnabled()` also requires `typeof window === "undefined"` (server only). Both fetches run in parallel; either may be null.
- **`onpage.ts`**: cheerio-based signal extraction (title, meta description incl. og fallback, h1 count, resolved canonical, meta-robots noindex/none, valid JSON-LD, and primary word count after stripping script/style/noscript/svg/template). Runs on **both** raw and rendered HTML.
- **`renderMode.ts`**: diffs raw vs rendered. `CONTENT_MIN_WORDS=120`; JS "injects content" if rendered ≥ 2× raw words AND +100 absolute. Modes: `client-rendered` (raw thin, rendered has content → **jsGated**), `mixed` (raw has content but JS adds a lot, or SEO tags only after JS → jsGated), `ssr` (content in raw). SEO tags present only after JS (title/canonical/json-ld/h1) force `jsGated=true`. Without a rendered pass → `unknown`, `jsGated:false`.
- **`gate.ts`**: pure verdict battery. **Block** (can't index): `http_status!=200`, `is_redirect`, `robots_disallowed`, `has_noindex`, `not_self_canonical` (canonical present but points elsewhere). **Flag** (indexable but weak): `missing_canonical`, `missing_title`, `missing_meta_description`, `missing_h1`, `multiple_h1`, `missing_schema`, `js_gated`, `thin_or_duplicate` (`contentWords<120` OR `uniquenessRatio<0.5`). Verdict = block>flag>pass.
- **`classify.ts`**: maps each failure → `{label, rootCause, owner, route, fix}` and a **priority** via `priorityFor(isBlock, isMoney)` (block+money=p0, block=p1, flag+money=p1, flag=p2). Mechanical fixes route to **PR** (noindex, canonical, redirect, title/meta/h1/schema); rendering + thin/dup route to **ticket**. HTTP-status failures classified by range (5xx/404-410/other). **`predictCoverage`** predicts the GSC coverage state from crawl signals alone — the headline case being a js-gated template → "Crawled – currently not indexed" attributed to RENDERING.
- **`cwv.ts`**: one PageSpeed Insights v5 call per representative URL. Pass/fail judged on **field (CrUX p75)** data (LCP good≤2500 poor>4000, INP good≤200 poor>500, CLS good≤0.1 poor>0.25; CrUX CLS ×100 normalized to 0–1). Lighthouse lab audits drive per-metric diagnosis (LCP element/TTFB/render-blocking; INP long-tasks/bootup/main-thread; CLS shifting/unsized images). 30 s timeout; without `PAGESPEED_API_KEY` PSI quota is 0 so field data is empty.
- **`routing.ts`**: **`buildRoutingPreviews`** groups PR issues by reason (one template-wide PR) and ticket issues by reason+template (one ticket per failing template), aggregates URLs/priority/money-flag, and renders a markdown body preview. **`buildCwvTickets`** turns each failing-field CWV template into a webdev ticket (money=p1 else p2 — never p0, since CWV is a secondary signal). Everything is **preview-only**.
- **`repo.ts`** (GitHub PR): Octokit branch→blob→tree→commit→PR flow; **never merges**. Target is `TARGET_REPO` (base `TARGET_REPO_BASE_BRANCH||main`), auth `GITHUB_BOT_TOKEN`. **Important caveat baked into the code**: the target is a proof-of-concept repo (comment names `Vyro-ai/imagine-motion-design-web`), NOT the repo that renders imagine.art, so the PR commits a clearly-labeled **proposal markdown** file under `seo-proposals/…`, never a guessed edit to a real template.
- **`linear.ts`** (Linear ticket): raw GraphQL. Auth `LINEAR_API_KEY` (used directly, no "Bearer"). Team from `LINEAR_TEAM_ID` or resolved from `LINEAR_TEAM_KEY`. Tickets are filed into a dedicated project (`LINEAR_PROJECT_ID`, else found-or-created by name "SEO — Indexing & CWV (automated)"). Priority mapped p0→1/p1→2/p2→3.
- **`gsc.ts`**: Google Search Console URL-Inspection + Search Analytics via a service account (`GSC_PROPERTY` + `GSC_SA_JSON` or `GSC_SA_JSON_BASE64`). `isGscConfigured()` gates live enrichment; every call returns null/[] on any failure so a bad call never breaks the scan. Run enrichment is bounded to the first 40 URLs at concurrency 3 (quota-aware).
- **`slackPreview.ts`**: composes the severity-routed digest text (money-page P0 section, indexing+CWV stats, js-gated templates, failing-CWV templates, routing counts). Report-only string.
- **`persist.ts`**: `saveRun` (one `indexing_runs` row with the full report JSONB), `logDispatch` (`indexing_dispatches`), `listRuns`, `getRunReport`. Persist failures are logged but return null/[] (non-fatal).

---

### Key checks & validations

- **Webhook** must match `^https://hooks\.slack\.com/`; **bot token** must match `^xox[bp]-` AND successfully list ≥1 workspace user (else rolled back).
- **Ignore** requires a non-empty string `link`; ignoring purges existing findings for that link across all runs.
- **Broken-link false-positive guards**: non-200/bot-block/5xx → unreachable (not broken); social/bot-walled hosts and tweet-embed hosts → alive; healthy-shell 404s → unreachable; catch-all echo probes → unusable (won't flag live pages); ambiguous author matches → plain name (no @-mention).
- **Indexing run limit** clamped 1–40 (route) / ≤100 (`runIndexingReport`). History limit ≤100. GSC enrichment ≤40 URLs. CWV ≤8 templates (`cwvMaxTemplates`).
- **Gate thresholds**: `minContentWords=120`, `minUniqueness=0.5`. **Self-canonical** compared host-normalized (strip `www.`, trailing slash, lowercase).
- **Write actions are session-only and human-triggered**: `/pr`, `/ticket`, `/slack` reject non-session callers; the scan (`/run`) never dispatches anything.

### Integration keys / environment variables

- `CRON_SECRET` — Bearer/`?key=` auth for cron-driven routes (when unset, all routes are open).
- `AUTH_SECRET` — derives the AES-256-GCM key encrypting the webhook + bot token (`src/lib/crypto.ts`).
- `UPSTASH_REDIS_REST_URL` / `_TOKEN` — Redis (state, locks, ignore list, Slack settings). Without it, `redis()` is null: no durable state/stop, `setWebhook`/`setBotToken`/`setSlackMap`/`addIgnoredLink` throw, and locks treat the caller as sole instance.
- `QSTASH_TOKEN` + `APP_URL`/`NEXTAUTH_URL` — auto-continue chunked crawls (`qstashPublish`). Without it, a chunked crawl that hits the time budget on Vercel will not resume.
- `OPENROUTER_API_KEY` — Haiku author fallback, location hints, and the Slack intro line (all degrade gracefully to deterministic/plain output).
- `SLACK_BROKEN_LINKS_WEBHOOK` — env fallback for the webhook if Redis has none.
- `PLAYWRIGHT_ENABLED=true` — required for render-diff / js-gated detection (else render mode is `unknown` and js-gated can't be found; a report note flags this).
- `PAGESPEED_API_KEY` — required for CWV field data (PSI quota is 0 without it).
- `GSC_PROPERTY` + `GSC_SA_JSON`/`GSC_SA_JSON_BASE64` — live Google coverage.
- `TARGET_REPO`, `TARGET_REPO_BASE_BRANCH`, `GITHUB_BOT_TOKEN` — PR dispatch.
- `LINEAR_API_KEY` + `LINEAR_TEAM_ID`/`LINEAR_TEAM_KEY` (+ optional `LINEAR_PROJECT_ID`) — ticket dispatch.
- `DATABASE_URL` / Supabase admin — `link_audit_runs`, `link_audit_findings`, `indexing_runs`, `indexing_dispatches`.

### Data model

- **`link_audit_runs`** (migration `scripts/021_link_audit.mjs`): id, started/finished_at, status (`running|completed|failed`; code also sets `stopped`), pages_total/checked, links_checked, broken_found, unreachable, error, slack_posted_at.
- **`link_audit_findings`** (021 + `022` location_hint + `023` occurrences): run_id (FK cascade), page_url, page_author, link_url, anchor_text, context_text, reason (`http-404|http-410|soft-404|homepage-redirect|unreachable`), http_status, location_hint, occurrences (jsonb), UNIQUE `(run_id, page_url, link_url)`.
- **`indexing_runs`** (`scripts/037_indexing_reports.mjs`, file header says 032): summary columns + full `report` jsonb + created_by.
- **`indexing_dispatches`**: run_id (FK cascade), kind (`pr|ticket|slack`), reason, title, target_ref, status (`ok|error`), error, dispatched_by.

---

### Flows

**A. Broken-link crawl (manual "Run now")**
1. User clicks **Run now** → `POST /api/link-audit/run {}`.
2. Route acquires the start lock, checks for an active run, else `startAudit()`: fetch sitemap → insert `running` run row → init Redis state.
3. `after()` runs `processAuditChunk()` in the background; the response returns immediately with `{started, runId, pagesTotal}`.
4. The chunk crawls pages (concurrency 8), harvests authors, checks links, upserts findings, updates the run row every 5 pages, and heartbeats Redis state.
5. The page polls `/status` (+ `/findings`) every 4 s, streaming progress, the verbose log, and live findings.
6. On Vercel time budget, the chunk publishes a QStash `{continue:true}` message to `/run`, which resumes in a fresh invocation.
7. On completion: backfill authors, compute AI location hints, mark `completed`, post the Slack digest (grouped, authored-first, @-mentioning resolved authors), stamp `slack_posted_at`, clear state.

**B. Stopping a crawl**
1. User clicks **Stop** → `POST /api/link-audit/stop` sets the durable Redis stop flag.
2. Before its next page, whichever chunk/instance is running sees the flag, marks the run `stopped` with partial counts, keeps findings so far, clears state + flag.

**C. Ignoring a false positive**
1. User clicks **Ignore** on a broken-link group → optimistic UI removal → `POST /api/link-audit/ignore {link}`.
2. Server adds the link to the Redis ignore list and deletes its findings across all runs. Future crawls skip it entirely. **Un-ignore** removes it from the list (re-checked next run; old findings are not restored).

**D. Slack setup + test**
1. User pastes a webhook (and optionally an `xoxb-` token) → **Save settings** → `POST /api/link-audit/settings`. Token is validated by listing users; a bad token is rolled back.
2. **Send test to Slack** re-posts the latest run's real digest (or a hello) plus an author-tag test proving which names resolve to @mentions.

**E. Page-health scan (manual)**
1. User picks scope/count (+ advanced device/template) → **Check my pages** → `POST /api/indexing/run`.
2. `runIndexingReport`: discover (stratified sample) → fetch raw+rendered per URL → per-template uniqueness (shingled Jaccard) → gate + classify + predict → optional live GSC enrichment (≤40 URLs) → template summaries → CWV per top-8 templates → routing previews + Slack preview.
3. Route persists a summary (`saveRun`) and returns the full report; the UI renders the five tabs.

**F. Dispatching a fix**
1. On a "What to fix" card, user clicks **Draft the fix (pull request)** or **Create a ticket** → `POST /api/indexing/pr` or `/ticket` with `{preview, runId}`.
2. PR path opens a branch + proposal-markdown PR (never merges) on the PoC target repo; ticket path creates a Linear issue in the dedicated SEO project. Either logs a dispatch row and returns the URL; the card links out to it.
3. **Share to Slack** posts `report.slackPreview` to the shared link-audit webhook.

**G. Nightly automation**
1. `/api/cron/daily` (external scheduler) fans out → `/api/link-audit/run` (flow A) and `/api/indexing/cron`.
2. `/api/indexing/cron` scans the top 25 money-first pages, persists, and posts a digest (louder `:rotating_light:` header when a money-page P0 exists) to the shared webhook. `?dry=1` skips the post.

---

### Edge cases & cautions

- **The PR target repo is a proof-of-concept, not the real site codebase.** `openProposalPr` commits a labeled proposal `.md`, not an edit to a live template — a maintainer expecting a merge-ready code fix will be surprised. There is no URL→source-file mapping.
- **No Vercel cron entry for this area.** `vercel.json` only schedules `/api/emails/process`. The daily link-audit + page-health work depends on something external hitting `/api/cron/daily`; if nothing does, the "daily cron" the UI promises never fires.
- **Redis is load-bearing but silently optional.** Without Upstash: no durable crawl state (runs can't chunk/resume/stop across instances), the webhook/bot-token/slack-map/ignore-list setters **throw** (Save/Ignore fail), and `getWebhook` only works via `SLACK_BROKEN_LINKS_WEBHOOK`. Locks degrade to "always acquired" (assumes a single instance).
- **QStash absent → truncated crawls on Vercel.** A crawl that hits the 210 s budget calls `qstashPublish`; if QStash/base URL aren't set it returns false and the run silently stops mid-way (state persists but nothing resumes it, and the run never reaches `completed`/Slack). The "running" flag also flips off after 10 min of no heartbeat, so the UI eventually shows it as stale.
- **`slack_posted_at` never gets set on a stalled run**, so the daily digest simply won't arrive; there's no retry.
- **Digest/hint AI calls are best-effort.** Missing/invalid `OPENROUTER_API_KEY`, timeouts, or malformed replies all fall back to deterministic text — location hints and the intro line just get simpler, never blocking the run.
- **False-negative bias is deliberate.** A branded 404 page with no "404/not found" wording in its title/h1 (and >2KB body) slips through as alive; healthy-shell SPA 404s are marked unreachable. The design explicitly prefers a rare miss over falsely pinging a writer.
- **Soft-404 fingerprinting can't help bot-walled or catch-all hosts.** Social hosts are skipped; catch-all echo probes are marked unusable; so genuinely-dead links on those platforms (short of a hard 404) won't be caught.
- **Author attribution is heuristic.** Card-harvested authors, byline regexes, and a Haiku fallback (blogs only) can all miss or mis-assign; a page's own byline is prioritized (`!`-prefixed keys) but non-blog pages get no AI fallback at all.
- **Auto-@-tagging quietly declines on ambiguity.** If two workspace members match a name tier, no mention is made (plain name shown) — safer, but a maintainer may wonder why a known author wasn't tagged. The user directory is cached 12 h, so newly-added members won't tag until the cache expires or the token is re-saved.
- **`js_gated` detection requires Playwright.** With `PLAYWRIGHT_ENABLED` off, render mode is `unknown` and js-gated is always false — the headline "hidden from search" metric silently reads 0, masking the very problem the tool exists to find. A report note warns, but the stat tiles don't.
- **CWV needs both a PSI key and enough CrUX traffic.** Low-traffic templates show "Not enough real-visitor data yet" and generate no ticket even if slow; without `PAGESPEED_API_KEY` every template is empty.
- **Indexing history routes are session-only**, but `/run` and `/cron` accept `CRON_SECRET`; the scan itself has no side effects, so an over-broad `CRON_SECRET` can only trigger scans, not dispatches.
- **The stop flag has a 1 h TTL.** `startAudit` clears any stale flag on a fresh start, but a stop requested against a run that already ended lingers up to an hour and could abort the very next run if it starts within that window before `startAudit`'s clear runs (mitigated because `startAudit` clears it, but the ordering matters).
- **Findings view caps at 500 rows** (`/findings`) and each broken link caps at 5 finding pages (`MAX_PAGES_PER_BROKEN_LINK`); a link broken across hundreds of pages shows only a sample count.
- **`removeIgnoredLink`/`unignoreLink` don't restore purged findings** — the link is simply eligible again on the next crawl.
- **Redis writes are fire-and-forget in places** (`.catch(() => {})` on state/checked/fp saves): a transient Redis error mid-run can lose recent progress without surfacing an error, though periodic re-saves usually recover it.

---

## Notifications & Author Watches

### Purpose

This area lets a signed-in user **watch specific writers (authors)** and be told whenever one of them publishes something new. For each watched author the system periodically re-fetches that author's known "author page" (their byline/archive page on their publication), extracts links, profiles any genuinely new articles through the normal discovery pipeline, and — if the article really turns out to be by the watched author — records an in-app **notification** and (optionally) sends an **email** to every user watching that author.

The whole feature is built from three data concepts:

- **`author_watches`** — one row per `(user_email, author_id)`: "this user is watching this author." Carries a `last_checked_at` timestamp.
- **`author_watch_notifications`** — one row per `(user_email, article_id)`: "this user was notified about this article." Carries `created_at`, `read_at`, and `emailed_at`.
- The **check/poll mechanism** (`checkAndNotifyAuthor` in `src/lib/pipeline/watch.ts`) — the shared engine used both by the batch "daily check" route and the per-author "Test watcher" button.

The single page is `src/app/notifications/page.tsx` (route `/notifications`). It combines an author picker, the watch list (with a per-author "Test watcher" action), and a notification activity feed.

---

### UI walkthrough

All UI lives in `src/app/notifications/page.tsx` (client component, `"use client"`). Layout: centered column, `max-w-4xl`, with four stacked sections.

#### Header (lines 134–145)
- Violet bell icon tile + title **"Notifications"**.
- Subtitle: *"Watch specific writers — we check once a day and email you when they publish something new."* (Note: the "once a day" claim depends on an external cron trigger — see Edge cases.)

#### "Watch a writer" picker (lines 147–187)
- A bordered card labeled **"Watch a writer"**.
- A **search input** (`placeholder="Search prospects by name or publication…"`) with a magnifier icon on the left and a spinner (`Loader2`) on the right while searching.
- Typing calls `runSearch(q)` (lines 87–94) on every `onChange`:
  - If the trimmed query is **shorter than 2 characters**, results are cleared and nothing is fetched.
  - Otherwise it sets `searching=true` and calls `GET /api/prospects?search=<q>&limit=15`, reading `res.prospects`. On any HTTP error or exception, results become `[]`. There is **no debounce** — one request fires per keystroke.
- The results dropdown only renders when `query.trim().length >= 2` (line 160):
  - **Empty state**: if there are no results and not currently searching, shows *"No matching prospects"* (centered, small).
  - Each result row (lines 165–182) shows the author's `full_name` and, beneath it, `domain.name ?? domain.host ?? "—"`.
  - A **Watch button** on the right:
    - If the author is **already watched** (`watchedIds` contains `r.author.id`), the button is a disabled `ghost` variant reading **"Watching"** with a `CheckCircle2` icon.
    - Otherwise it's an `outline` button reading **"Watch"**. Clicking calls `addWatch(r.author.id)`.
    - While that specific author's add is in flight (`addingId === r.author.id`), the button shows a spinner and is disabled.
- `addWatch` (lines 96–106): sets `addingId`, POSTs `{ author_id }` to `/api/notifications/watches`, clears `addingId`, shows a success toast *"Watching — you'll be notified of new posts."*, then reloads. Note the toast fires **unconditionally** even if the POST failed (the `.catch(() => {})` swallows errors) — see Edge cases.

#### "Watching (N)" list (lines 189–274)
Header label shows the live count `Watching ({watches.length})`.
- **Loading state**: while `loading` is true, a centered spinner + "Loading...".
- **Empty state**: if not loading and no watches, *"Not watching anyone yet — search above to add a writer."*
- Otherwise a bordered, divided list. Each row (`w.author_id` keyed) shows:
  - **Author name** as a button — clicking calls `openAuthor(w.author_id)`, which opens the shared **ProspectDrawer** side panel (via `useAuthorDrawer`, which fetches `GET /api/authors/:id`). Hover styles: violet + underline.
  - A sub-line: `domain.name ?? domain.host ?? "—"` · `checked <timeAgo(last_checked_at)>`. `timeAgo` (lines 41–50) renders "never checked" (null), "just now" (<1 min), "Nm ago", "Nh ago", or "Nd ago".
  - `hasPage` is computed (line 199) as whether the author's `contacts` include a `type === "author_page"`. If **no** author page, the sub-line appends *"· no known page to check yet"*.
  - **"Test watcher" button** (lines 214–222): outline button with a `FlaskConical` icon, tooltip *"Run the same daily check right now, for just this writer"*. Disabled while that author is testing (`testingId === w.author_id`), during which it shows a spinner. Calls `testWatcher(w.author_id)`.
  - **Remove (X) button** (lines 223–225): ghost icon button, tooltip *"Stop watching"*. Calls `removeWatch(w.author_id)`.
- **Verbose test result block** (lines 229–268): rendered only when `testResults[w.author_id]` exists (populated by a completed test). It shows:
  - **Website line**: bold website name (or "Unknown website"). If `checked` is true, *"— checked <authorPageUrl>"* (URL is a link opening in a new tab). If `checked` is false, an amber *"— no known page on file to check"*.
  - **Result summary**: if `newArticlesFound > 0`, green text *"N new article(s) found — X notified, Y emailed"*. Else if `checked`, *"No new articles — everything on their page is already on file."* Else (not checked), nothing.
  - **New-articles list**: for each of `result.newArticles`, a link to the article (title or URL) + `· <fmtDate(publishedAt)>`, in a green left-bordered block. `fmtDate` (lines 27–31) renders "no date on file" for null/unparseable dates, otherwise "Mon D, YYYY".
  - **"Latest on file" line**: the most recent article currently stored for the author (`latestArticle`), or *"no articles on file for them yet"* if none.

#### "Recent activity" notification feed (lines 276–304)
- Header label **"Recent activity"**.
- **Empty state**: *"No new content yet from anyone you're watching."*
- Otherwise a list of notification cards (lines 283–301). Each card:
  - **Unread** cards (`read_at` null) have a violet border + violet-tinted background and an `Eye` icon on the right; the `FileText` icon is violet.
  - **Read** cards have a plain border and muted icons; no `Eye`.
  - Content: *"<author.full_name> posted new content"*, then a violet link to `article.url_canonical` showing `article.title ?? url_canonical` (opens new tab), then `new Date(created_at).toLocaleString()`.
  - **Clicking anywhere on an unread card** calls `markRead(n.id)` (the `onClick` is guarded by `!n.read_at`). Clicking the **article link** calls `e.stopPropagation()` so opening the article does **not** also mark it read.

#### Polling & data loading (lines 69–85)
- `load()` fetches watches and notifications **in parallel** (`Promise.all`) from `/api/notifications/watches` and `/api/notifications`. Any error → falls back to `[]`. Sets `loading=false`.
- On mount, `load()` runs immediately and then `setInterval(load, 60_000)` re-loads every **60 seconds** for UI freshness only (the interval is cleared on unmount). This is a pure UI refresh — it does **not** trigger any server-side checking.

---

### API routes / server logic

#### `GET /api/notifications` — notification feed
File: `src/app/api/notifications/route.ts`.
- Auth: `currentEmail()` reads the NextAuth session email; if none → **401** `{ error: "not signed in" }`.
- Otherwise returns `getUserNotifications(email)`.
- `getUserNotifications` (queries.ts:2522) selects from `author_watch_notifications` where `user_email = email`, joining `author:authors(id, full_name)` and `article:articles(id, title, url_canonical, published_at)`, ordered by `created_at` descending, **limit 100**.
- Only branches: 401 (unauthenticated) or 200 (array, possibly empty). A DB error would throw (uncaught → 500).

#### `PATCH /api/notifications/[id]` — mark one read
File: `src/app/api/notifications/[id]/route.ts`.
- Auth: `currentEmail()`; none → **401**.
- Reads `id` from the (awaited) route params. No request body.
- Calls `markNotificationRead(id, email)` → updates `read_at = now()` **scoped to both `id` and `user_email`** (queries.ts:2533), so a user can only mark their own notifications. If `id` doesn't exist or isn't theirs, the update matches zero rows and silently no-ops.
- Always returns **200** `{ ok: true }` (even when nothing was updated). No "not found" branch.

#### `GET /api/notifications/watches` — list watches
File: `src/app/api/notifications/watches/route.ts`.
- Auth: `currentEmail()`; none → **401**.
- Returns `getUserWatches(email)` (queries.ts:2473): selects from `author_watches` where `user_email = email`, joining `author:authors(id, full_name, avatar_url, domain:domains(host, name), contacts(type, value))`, ordered by `created_at` descending. Returns `[]` if none.

#### `POST /api/notifications/watches` — add a watch
File: `src/app/api/notifications/watches/route.ts`.
- Auth: `currentEmail()`; none → **401**.
- Body: JSON `{ author_id }`. Parsed with `.catch(() => ({}))` so malformed JSON becomes `{}`.
- Validation: if `author_id` is falsy → **400** `{ error: "author_id required" }`.
- Calls `addAuthorWatch(email, author_id)` (queries.ts:2457) → **upserts** into `author_watches` with `onConflict: "user_email,author_id"`. So watching the same author twice is idempotent (no duplicate, no error).
- Returns **201** `{ ok: true }`.
- Note: `author_id` is **not validated against the authors table** — a non-existent author id would still insert a watch row (subject to any DB foreign-key constraint; if an FK exists it would throw → 500).

#### `DELETE /api/notifications/watches/[authorId]` — remove a watch
File: `src/app/api/notifications/watches/[authorId]/route.ts`.
- Auth: `currentEmail()`; none → **401**.
- Reads `authorId` from awaited params.
- Calls `removeAuthorWatch(email, authorId)` (queries.ts:2464) → deletes from `author_watches` matching **both** `user_email` and `author_id` (can only remove your own watch). Deleting a non-existent watch is a silent no-op.
- Always returns **200** `{ ok: true }`.

#### `POST /api/notifications/watches/[authorId]/test` — Test watcher
File: `src/app/api/notifications/watches/[authorId]/test/route.ts`.
- Auth: `currentEmail()`; none → **401**.
- Loads `before = getAuthorDetail(authorId)` (full author profile incl. contacts, articles sorted newest-first). If null → **404** `{ error: "author not found" }`.
- Derives `authorPageUrl` = the value of the `author_page` contact (or null) and `website` = `domain.name ?? domain.host ?? null`.
- Runs `checkAndNotifyAuthor({ id, full_name, contacts }, resolveSenderInfo)` — the **exact same engine as the daily batch**, but for this one author, using the **uncached** `resolveSenderInfo` (fine for a single author).
- Re-fetches author detail only if something new was found (`found.length > 0`), so a freshly-created article shows up as "latest"; otherwise reuses `before`. `latest = after.articles[0] ?? null`.
- Returns **200** with: `website`, `checked` (= `!!authorPageUrl`), `authorPageUrl`, `newArticlesFound` (count), `newArticles` (title/url/publishedAt each), `notified`, `emailed`, `latestArticle` (title/url/publishedAt or null).
- Important: `checked` is derived purely from whether an `author_page` contact exists — **not** from whether the fetch succeeded. `checkAndNotifyAuthor` always stamps `last_checked_at` (see below), so the client reload afterward shows an updated "checked" time.

#### `POST` / `GET /api/notifications/check` — the batch check/poll
File: `src/app/api/notifications/check/route.ts`. `maxDuration = 300` (5-minute serverless budget). Both `GET` and `POST` are supported (GET simply calls POST) because Vercel cron issues GET.
- **Authorization** (`authorized`, lines 14–22) — same convention as `/api/emails/process`:
  - If `CRON_SECRET` env is **unset**, returns `true` (open) — intended for local dev.
  - Else authorized if the `Authorization` header equals `Bearer <CRON_SECRET>`, **or** query param `?key=<CRON_SECRET>`, **or** there is any logged-in session (`!!session`) — the last clause lets a signed-in user trigger a manual "check now."
  - Unauthorized → **401** `{ error: "unauthorized" }`.
- **Distributed lock**: acquires `lock:notifications:check` via Redis (`acquireLock`, TTL 290s) with a random token. If not acquired (another check running) → returns `{ skipped: "another check is in progress" }` (HTTP 200). Released in a `finally`. If Redis is unconfigured, `acquireLock` returns `true` (single-instance assumption).
- **Sender-info cache**: a per-invocation `Map<email, SenderInfo>` so decrypting each watcher's app password and reading their `from_name` happens at most once per email across all authors.
- **Core loop**: `authors = getDistinctWatchedAuthors(200)`. For each author, `authorsChecked++`, then `checkAndNotifyAuthor(author, getSenderInfo)` wrapped in `.catch(() => ({ found: [], notified: 0, emailed: 0 }))` so **one author's failure never aborts the batch**. Accumulates `newArticles`, `notified`, `emailed`.
- Returns **200** `{ authorsChecked, newArticles, notified, emailed }`.
- `getDistinctWatchedAuthors` (queries.ts:2485): selects up to `limit` (200) `author_watches` rows ordered by `last_checked_at` **ascending, nulls first** (stalest / never-checked first), then dedupes by `author_id` in JS. So each distinct author is checked **once per run**, not once per watcher.

---

### The check engine (`src/lib/pipeline/watch.ts`)

This shared module is the heart of the feature.

#### `checkAuthorForNewContent(author)` (lines 35–65)
1. Finds the author's `author_page` contact value. If none → returns `[]` (nothing to check).
2. `fetchPage(authorPage)` — fetches the page HTML. If it fails/returns nothing → `[]`.
3. `extractSameDomainLinks(html, finalUrl, MAX_CANDIDATES_PER_AUTHOR=20)` — up to 20 same-domain candidate links from the page. Empty → `[]`.
4. **De-dupe against full history**: queries `articles` for any `url_canonical` already present among the candidates; drops known ones. "New" is **existence-based, not date-based** — a URL counts as new only if it's nowhere in the article history yet. If nothing fresh → `[]`.
5. `getSeeds()` then for each fresh URL runs `processHit("watch:<authorId>", url, "watch", seeds)` — the **same** extraction/relevance/archetype/safety/scoring path as normal discovery. This is where the LLM cost is spent (only on fresh URLs).
6. **Byline guard**: only counts the article if `processHit` returns an `authorId === author.id`. A multi-author archive page can list other people's bylines; those are skipped (`continue`).
7. For each confirmed match, reads back the article row (`id, title, published_at`) and pushes `{ articleId, url, title, publishedAt }`.

#### `checkAndNotifyAuthor(author, getSenderInfo)` (lines 72–98)
1. `found = checkAuthorForNewContent(author)`.
2. If anything found: `watchers = getWatchersOf(author.id)` (all `user_email`s watching this author). For **every article × every watcher**:
   - `insertWatchNotification({ user_email, author_id, article_id })` — upsert with `onConflict: "user_email,article_id", ignoreDuplicates: true`. This makes the whole thing **idempotent**: re-running never double-inserts a notification for the same user+article. `notified++` counts the attempt regardless of whether it was a genuine insert or a swallowed duplicate.
   - Resolves `SenderInfo` (app password + from_name) via `getSenderInfo(userEmail)`.
   - Composes a fixed email: subject `New post from <full_name>`, body naming the article title + URL and a "you're getting this because you're watching …" footer.
   - If the watcher **has** a decrypted app password → `sendEmailAs` (sends **from and to the watcher's own Gmail** via their app password). If **not** → `sendEmail` (the shared/global SMTP transport, `to` the watcher). `emailed++` only if the send returned `{ ok: true }`.
3. **Always** calls `touchWatchLastChecked(author.id)` at the end — updating `last_checked_at = now()` for **all** watch rows of that author, whether or not anything was found or the page even existed.
4. Returns `{ found, notified, emailed }`.

`resolveSenderInfo` (lines 102–105) is the default (uncached) resolver: `getUserAppPasswordEnc` + `getUserEmailConfig`, `pass = decryptSecret(enc)`. The batch route supplies its own cached equivalent.

---

### Key checks & validations

- **Authentication** on every user-facing route via the NextAuth session email; unauthenticated → 401. `currentEmail()` swallows `auth()` errors and returns null (treated as unauthenticated).
- **Ownership scoping**: mark-read and remove-watch both filter by `user_email`, so a user can only touch their own rows.
- **`author_id` required** on POST watch (400 otherwise).
- **Author existence** is checked in the Test route (404) but **not** in the add-watch route.
- **`author_page` contact presence** gates whether an author is actually fetchable; absence yields an empty result and the UI "no known page to check yet" hint (`hasPage` in the list; `checked=false` in the test result).
- **Byline verification** (`authorId === author.id`) prevents attributing another writer's article to the watched author.
- **Idempotency** on two levels: `author_watches` upsert on `(user_email, author_id)`, and `author_watch_notifications` upsert (ignoreDuplicates) on `(user_email, article_id)`.
- **Concurrency**: the batch check is guarded by a Redis lock (`lock:notifications:check`, 290s TTL) so overlapping cron/manual triggers don't run simultaneously.

---

### Flows

**Watch a writer (user):**
1. On `/notifications`, type ≥2 chars into "Watch a writer".
2. Each keystroke calls `GET /api/prospects?search=…&limit=15`; matches render in the dropdown.
3. Click **Watch** → `POST /api/notifications/watches {author_id}` → upsert into `author_watches` → 201.
4. Success toast; `load()` refreshes the watch list (author now shows with "never checked").

**Daily batch check (data):**
1. External trigger hits `GET/POST /api/notifications/check` (with `Bearer CRON_SECRET`, `?key=`, or a logged-in session).
2. Authorized → acquire Redis lock (or skip if held).
3. `getDistinctWatchedAuthors(200)` (stalest first, deduped).
4. For each author: `checkAndNotifyAuthor` → fetch author page → extract links → drop known URLs → `processHit` fresh ones → byline-verify → for each new article, insert a notification row per watcher and email each watcher → stamp `last_checked_at`.
5. Release lock; return aggregate counts.
6. Watchers see new cards next time the page loads (or within the 60s auto-refresh) and receive emails.

**Test watcher (user, single author):**
1. Click **Test watcher** on a watch row → `POST /api/notifications/watches/:authorId/test`.
2. Load author detail (404 if missing); derive `website`/`authorPageUrl`.
3. Run the **same** `checkAndNotifyAuthor` for that one author (records + emails real notifications — this is not a dry run).
4. Re-fetch if new articles were found; return verbose JSON.
5. UI stores it in `testResults[authorId]`, shows a toast ("no page" / "found N — notified & emailed" / "nothing new"), and calls `load()` to refresh `last_checked_at` and the feed.

**Mark read (user):**
1. Click an unread notification card → optimistic local `read_at` set → `PATCH /api/notifications/:id`.
2. Server sets `read_at = now()` scoped to id + user_email → 200. Clicking the article link instead opens the article without marking read (stopPropagation).

**Remove watch (user):**
1. Click the X → optimistic local removal from the list → `DELETE /api/notifications/watches/:authorId`.
2. Server deletes the row (scoped to user). No toast, no reload; UI already reflects removal.

---

### Edge cases & cautions

- **No cron entry for `/api/notifications/check`.** `vercel.json` only schedules `/api/emails/process` (`0 13 * * *`); there is **no** `crons` entry for the notifications check. The UI promises "we check once a day," but that promise depends on an external trigger (a manually-added Vercel cron, QStash, or a signed-in user hitting the endpoint) that is **not wired in this repo**. Without it, the only actual checks happen via the manual "Test watcher" button. This aligns with the known "needs cron" gap noted for email sending.
- **`addWatch` shows a success toast even on failure.** The POST's `.catch(() => {})` swallows network/HTTP errors, and the toast + `load()` run unconditionally. A failed add would silently show "Watching…" then quietly disappear on the next reload.
- **Remove watch is fire-and-forget and optimistic.** If the DELETE fails, the row is already gone from the UI but still in the DB; it reappears only after a full reload. No error surface.
- **No debounce on search** — one `/api/prospects` request fires per keystroke; fast typing produces racing requests, and the last resolved response wins (potentially stale).
- **`processHit` cost & side effects**: the check profiles fresh URLs through the full discovery pipeline (LLM calls, DB writes). A watched author whose page lists many new links can incur up to 20 (`MAX_CANDIDATES_PER_AUTHOR`) profiling attempts per run. The daily batch is capped at 200 distinct authors per run (`getDistinctWatchedAuthors(200)`); with more than 200 watched authors, the stalest 200 are processed and the rest wait for a later run.
- **`last_checked_at` is stamped even when nothing was fetched.** `touchWatchLastChecked` runs unconditionally, including when the author has no `author_page` or the fetch failed — so "checked Xm ago" does **not** mean the page was successfully retrieved. The Test result's `checked` flag (page-on-file, not fetch-success) is the more honest signal, and even it doesn't reflect fetch failure.
- **`touchWatchLastChecked(authorId)` updates every watch row for that author** (no `user_email` filter) — correct for the shared-per-author model, but it means one user's test resets the "checked" clock for all watchers of that author.
- **Emails require SMTP/app-password config.** If a watcher has no app password, sending falls back to the shared SMTP transport (`sendEmail`); if that transport isn't configured (`SMTP_HOST/USER/PASS` missing) the send returns `{ ok:false }` and simply isn't counted in `emailed` — a **silent** non-delivery. The notification row is still recorded regardless of email outcome.
- **Test watcher is not a dry run.** It records real notification rows and sends real emails; the idempotent upsert prevents duplicates, but a first successful test will notify/email all watchers immediately.
- **`notified` counts attempts, not new inserts.** Because `insertWatchNotification` ignores duplicates silently, `notified++` increments even for already-seen (author, article) pairs, so the reported "notified" count can exceed the number of genuinely new notifications on a re-run.
- **Byline mismatch drops articles silently.** If `processHit` attributes an article to a different author (or fails, returning `undefined`), it's skipped with no signal to the user — a legitimately-new post can be missed if extraction misattributes the byline.
- **No authorization for `/check` when `CRON_SECRET` is unset.** In that configuration the endpoint is fully open (returns `true`), which is intentional for local dev but a risk if deployed without the secret.
- **`markNotificationRead` / `removeAuthorWatch` never surface "not found".** Both always return `{ ok: true }` even when zero rows matched (wrong id, or someone else's row), so callers can't distinguish success from a no-op.
- **DB errors bubble as 500s.** The user-facing GET/POST routes don't wrap the query calls in try/catch (unlike `/api/prospects`), so a Supabase error throws and yields an unstyled 500.

---

## Settings (Your Sending Email & Keys)

### Purpose

The Settings page is where a signed-in team member configures **how their own outreach email is sent** and where they can see, at a glance, the state of the app's server-side configuration. GenAI Scout is a per-user sender model: every user sends outreach from **their own Gmail mailbox** using a Gmail **app password** (never their normal Google password). This page is the one place that:

- Collects and stores that Gmail app password (encrypted at rest).
- Sets the per-user "from" identity (from name) and the sending schedule (timezone, daily send window, gap between sends, daily cap).
- Lets the user send a real test email to themselves to confirm the app password works before relying on it for live outreach.
- Manages the daily ops digest email (recipient + on/off toggle).
- Manages a rotating pool of Tavily search API keys.
- Renders a **read-only reference list** of the environment/API keys the app expects in `.env.local`, grouped by category, plus a quick-setup guide and a Vercel deployment note.

The page component lives at `src/app/settings/page.tsx`. It is a client component (`"use client"`) that composes three self-contained cards — `UserEmailConfigCard`, `DailyDigestCard`, `TavilyKeyManager` — followed by static informational cards.

This document focuses on the **sending email + app-password** area (`UserEmailConfigCard` and its two API routes) and the **env/keys reference list**, per the assigned scope. The Daily Digest and Tavily cards are described briefly because they render on the same page, but their own routes are documented elsewhere.

---

### UI walkthrough

#### Page-level layout (`src/app/settings/page.tsx`)

Top to bottom, the page renders:

1. An `<h1>` heading "Settings" (`page.tsx:40`).
2. `<UserEmailConfigCard />` — the per-user sending identity card (`page.tsx:44`).
3. `<DailyDigestCard />` — daily ops digest settings (`page.tsx:46`).
4. `<TavilyKeyManager />` — rotating Tavily key pool (`page.tsx:49`).
5. A muted helper line: "API keys and configuration are managed via `.env.local`. Restart the server after any changes." (`page.tsx:51-54`).
6. One `Card` **per config category**, driven by the hardcoded `CONFIG` array (`page.tsx:57-93`).
7. A "Quick Setup" card with 5 numbered steps (`page.tsx:96-118`).
8. A "Vercel deployment note" card, amber-tinted, about `PLAYWRIGHT_ENABLED` (`page.tsx:121-130`).

#### "Your sending email" card (`src/components/settings/UserEmailConfig.tsx`)

This is the primary component of this area. On mount it fetches `GET /api/user/email-config` (`UserEmailConfig.tsx:33-35`). Until that fetch resolves and sets state, the component renders **nothing** (`if (!cfg) return null;` at line 52) — there is no skeleton/loading UI.

Once loaded:

- **Card container styling** (`UserEmailConfig.tsx:55`): if `cfg.hasPassword` is false, the whole card gets an amber warning border/background (`border-amber-500/30 bg-amber-500/5`); if a password is set, no special styling.
- **Header title** (line 58): a `KeyRound` icon + "Your sending email".
- **Status badge** (lines 59-61): top-right outline badge. Reads **"✓ app password set"** (emerald) when `cfg.hasPassword`, otherwise **"⚠ app password required"** (amber).
- **Description** (line 63): "You send outreach from your own Gmail (`{cfg.user_email}`) using a Gmail **app password** — never your normal password." The user's own email is interpolated from the config.
- **"How to get a Gmail app password" help box** (lines 67-72): a muted bordered panel with three steps and two external links (open in a new tab, `rel="noreferrer"`):
  1. Turn on 2-Step Verification → `https://myaccount.google.com/signinoptions/two-step-verification`.
  2. Create an app password (pick "Mail") → `https://myaccount.google.com/apppasswords`.
  3. "Paste the 16-character code below (spaces are fine)."

**Input fields:**

- **App password** (lines 75-78): a `type="password"` input bound to local `pw` state (not to `cfg`). Its label appends "(set — type to replace)" in emerald when `cfg.hasPassword`. Placeholder is masked dots (`•••• •••• •••• ••••`) when a password already exists, otherwise a sample format (`abcd efgh ijkl mnop`). The current password is **never** loaded into this field — it starts empty every time and is only used to submit a *new* password. Leaving it blank on save keeps the existing password.
- **From name** (lines 80-82): a text input bound to `cfg.from_name` (falls back to `""`). Placeholder "Your Name". This becomes the display name on outgoing mail.
- **Timezone** (lines 87-90): a **native `<select>`** (not the Base UI Select component) bound to `cfg.timezone`, offering 13 hardcoded zones from the `TIMEZONES` array (`UserEmailConfig.tsx:13-17`): America/New_York, America/Chicago, America/Denver, America/Los_Angeles, Europe/London, Europe/Berlin, Asia/Karachi, Asia/Dubai, Asia/Kolkata, Asia/Singapore, Asia/Tokyo, Australia/Sydney, UTC.
- **Send from (hr)** (lines 92-95): `type="number"`, `min=0 max=23`, bound to `cfg.send_hour_start`. The start of the daily send window.
- **Send until (hr)** (lines 96-99): `type="number"`, `min=1 max=24`, bound to `cfg.send_hour_end`. The end of the daily send window.
- **Gap (min)** (lines 100-103): `type="number"`, `min=1`, bound to `cfg.gap_minutes`. Minimum spacing between two sends.
- **Max per day** (lines 104-107): `type="number"`, `min=1`, bound to `cfg.daily_cap`. Per-sender daily cap.

All four numeric inputs coerce their value via `Number(e.target.value)` on change (lines 94, 98, 102, 106).

**Buttons** (lines 110-119), bottom-right:

- **"Send test email"** (outline, lines 111-114): disabled while `testing` or when `!cfg.hasPassword`. Tooltip: "Send a test email to yourself" when enabled, "Save an app password first" when disabled. Shows a spinning `Loader2` while sending, otherwise a `Send` icon. Calls `sendTest()`.
- **"Save sending settings"** (primary, lines 115-118): disabled while `saving`. Shows a spinner while saving, otherwise a `Check` icon. Calls `save()`.

**`save()` behavior** (`UserEmailConfig.tsx:37-50`):
- Builds a body with `from_name`, `timezone`, `send_hour_start`, `send_hour_end`, `gap_minutes`, `daily_cap` from current `cfg`.
- Adds `app_password: pw.trim()` **only if** the password field is non-empty after trimming.
- `PATCH /api/user/email-config` with JSON.
- On success: replaces `cfg` with the returned config, **clears the password field** (`setPw("")`), and toasts "Sending settings saved."
- On failure: toasts "Couldn't save." No field-level validation is surfaced.

**`sendTest()` behavior** (`UserEmailConfig.tsx:25-31`):
- `POST /api/user/email-config/test` (no body).
- On `res.ok === true`: toasts success "Test email sent to `{cfg.user_email}` — check your inbox."
- Otherwise: toasts `res.error` if present, else "Test failed — double-check your app password." Note the fetch has a `.catch(() => ({ ok: false }))`, so a network failure produces the generic failure toast.

#### Env/API-keys reference list (config-status cards)

Driven entirely by the **hardcoded** `CONFIG` array (`page.tsx:20-32`). Each entry has `{ key, label, description, required, set, category }`. `CATEGORIES` is derived by de-duplicating the `category` field (`page.tsx:34`). The current entries:

| Category | Key | Required | `set` (hardcoded) |
|---|---|---|---|
| Database | `NEXT_PUBLIC_SUPABASE_URL` | required | true |
| Database | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | required | true |
| Database | `SUPABASE_SERVICE_ROLE_KEY` | required | true |
| Auth | `AUTH_SECRET` | required | true |
| Auth | `GOOGLE_CLIENT_ID` | required | true |
| Auth | `GOOGLE_CLIENT_SECRET` | required | true |
| Auth | `ALLOWED_DOMAINS` | required | true |
| AI/LLM | `OPENROUTER_API_KEY` | optional | true |
| Scraping | `PLAYWRIGHT_ENABLED` | optional | true |
| Scraping | `BRAVE_SEARCH_API_KEY` | optional | false |
| Scoring | `OPEN_PAGE_RANK_API_KEY` | optional | false |

For each category the page renders a `Card` (`page.tsx:57-93`):
- **Header** shows the category name and a status badge. `allSet` is computed as "every *required* item in this category has `set === true`" (`page.tsx:59`). Badge reads **"✓ Ready"** (emerald) when `allSet`, else **"⚠ Action needed"** (amber). Because optional keys are excluded from `allSet`, an unset optional key does NOT flip the category badge to "Action needed."
- **Body** lists each item: the env var name in violet monospace, a small "required"/"optional" badge, the description, and a right-aligned status — **"✓ set"** (emerald) if `item.set`, else **"not set"** (muted). A `Separator` is drawn between items (not after the last).

**Important:** `set` is a **static literal in the source array**, not a runtime check against `process.env`. The badges reflect what the developer hardcoded, not the actual environment. See Edge cases.

#### Quick Setup card (`page.tsx:96-118`)

Static, informational. Renders 5 numbered steps (violet numbered circles): run the SQL migration (`migrations/001_initial.sql`), set `.env.local` from `.env.example`, install Playwright chromium, `npm run dev`, then run first discovery. No interactivity.

#### Vercel deployment note (`page.tsx:121-130`)

Static amber-tinted card advising `PLAYWRIGHT_ENABLED=false` on Vercel so the app falls back to Cheerio static fetching. No interactivity.

#### Daily digest card (`src/components/settings/DailyDigestCard.tsx`) — adjacent

On mount fetches `GET /api/digest/settings`. Renders: a "Send the daily digest" `Switch` (persists immediately via `PUT /api/digest/settings` on toggle), a recipient email input + "Save" button (also `PUT`), and a "Send a test now" button (`POST /api/digest/daily?force=1`). The recipient input and both action buttons are disabled while empty/saving. Out of primary scope; routes documented elsewhere.

#### Tavily key manager (`src/components/settings/TavilyKeyManager.tsx`) — adjacent

On mount fetches `GET /api/admin/tavily-key`. Renders a header badge "`{poolActive}/{poolTotal}` keys active" plus a monthly search count, a textarea to paste one or more `tvly-…` keys (comma/newline separated) + "Add to pool" button (`POST`), and a list of pooled keys (masked value, active/exhausted badge, delete button → `DELETE ?id=…`). Empty state: "No keys in the pool yet…" Out of primary scope.

---

### API routes / server logic

#### `GET /api/user/email-config` (`src/app/api/user/email-config/route.ts:12-16`)

- **Auth:** resolves the caller's email via `currentEmail()` (lines 6-9), which calls `auth()` (imported from `@auth`, resolved via the tsconfig path alias to `auth.ts` at the project root — `tsconfig.json:23`) and reads `session.user.email`. `auth()` is wrapped in `.catch(() => null)`.
- **Response branches:**
  - Not signed in (`email` falsy) → `401 { error: "not signed in" }`.
  - Signed in → `200` with the result of `getUserEmailConfig(email)` — a **client-safe** config object (see below). Never includes the password or its ciphertext.

#### `PATCH /api/user/email-config` (`route.ts:19-36`)

- **Auth:** same `currentEmail()` check; `401 { error: "not signed in" }` if unauthenticated.
- **Body parsing:** `await req.json().catch(() => ({}))` — a malformed/empty body silently becomes `{}` (no fields updated, still a valid 200 save).
- **Field handling** (builds a `patch` object):
  - `app_password` (line 25-28): only if `typeof body.app_password === "string" && body.app_password.trim()`. The value has **all whitespace stripped** (`replace(/\s+/g, "")`) — because Gmail displays app passwords in space-separated groups — then encrypted via `encryptSecret(...)` and stored as `app_password_enc`.
  - `from_name`, `timezone` (line 29): copied through only if `typeof body[k] === "string"`. (An empty string passes this check, so from_name/timezone can be cleared to `""`.)
  - `send_hour_start`, `send_hour_end`, `gap_minutes`, `daily_cap` (line 30): copied through only if `body[k] != null`, coerced with `Number(...)`.
- **Persist:** `upsertUserEmailConfig(email, patch)` (see queries below), then returns the fresh `getUserEmailConfig(email)` as `200`.
- **Error branch:** any thrown error → `500 { error: e.message }`.
- **No server-side range validation:** there are no checks that `send_hour_start < send_hour_end`, that hours are 0-23, that `gap_minutes`/`daily_cap` are positive, or that `timezone` is a real IANA zone. The `min`/`max` on the number inputs are the only guardrails and are client-side only. `Number("")` coerces to `0`, and `Number("abc")` to `NaN`.

#### `POST /api/user/email-config/test` (`src/app/api/user/email-config/test/route.ts:9-30`)

Sends a **real** test email from the user's Gmail to themselves.

- **Auth:** reads `session.user.email` directly (with `auth().catch(() => null)`); `401 { error: "not signed in" }` if empty (lines 10-12).
- **Load & decrypt password:** `getUserAppPasswordEnc(email)` → `decryptSecret(enc)` (lines 14-15).
  - If `pass` is falsy → returns **`200`** `{ ok: false, error: "No app password saved yet — add one and save first." }`. Note: this is HTTP 200 with `ok:false`, not an error status. A decryption failure (returns `null`) is indistinguishable here from "never saved."
- **Load config:** `getUserEmailConfig(email)` for `from_name` (line 18).
- **Send:** `sendEmailAs({ user: email, pass, fromName: cfg.from_name, to: email, subject: "GenAI Scout — test email ✅", body: … })` (lines 19-26). The `to` is the user's own address, and the body confirms which address outreach will send from.
- **Response branches:**
  - `res.ok` → `200 { ok: true }`.
  - otherwise → `200 { ok: false, error: res.error ?? "send failed" }`. The `error` typically surfaces the SMTP/Gmail failure message (e.g. bad app password → auth error), which the client toasts.

`sendEmailAs` (`src/lib/email/smtp.ts:78-92`) builds a **throwaway** nodemailer transport to `smtp.gmail.com:465` (implicit TLS) authenticating as `user`/`pass`, sends, then closes the transport. Because it's built fresh each call, it always uses the just-saved password. The `from` header is `"{fromName}" <{user}>` when a from name exists, else just the address.

> Note: `smtp.ts` also defines `verifyGmail(user, pass)` (lines 95-104) which calls `tx.verify()` **without sending** — its comment says "Settings 'test connection'". However, the test route does **not** use it; it sends a real email via `sendEmailAs`. `verifyGmail` is currently defined but **unused anywhere** in the codebase.

#### DB queries (`src/lib/db/queries.ts`)

- **`getUserEmailConfig(userEmail)`** (lines 2054-2066): selects the single `user_email_config` row for the user (`.maybeSingle()`), and returns a **client-safe** shape (`UserEmailConfig` type, `src/lib/types.ts:299-308`):
  - `user_email` (echoed back), `from_name` (or `undefined`), `timezone`, `send_hour_start`, `send_hour_end`, `gap_minutes`, `daily_cap`, and `hasPassword: !!data?.app_password_enc`.
  - Any missing field falls back to `DEFAULT_USER_CONFIG` (line 2051): `timezone: "America/New_York"`, `send_hour_start: 9`, `send_hour_end: 17`, `gap_minutes: 15`, `daily_cap: 50`. So a brand-new user with **no row at all** still gets a fully-populated config with `hasPassword: false`.
  - **The plaintext password and its ciphertext are never returned.** Only the boolean `hasPassword`.
- **`upsertUserEmailConfig(userEmail, data)`** (lines 2068-2077): upserts into `user_email_config` keyed on `user_email` (`onConflict: "user_email"`), spreading whatever fields are in `data` plus `updated_at: now`. Accepts `app_password_enc`, `from_name`, `timezone`, the four numeric fields, and also `shared_sender_label`/`shared_sender_enabled` (used by the shared-sender admin feature, not by this page). Throws on Supabase error (caught by the PATCH handler → 500).
- **`getUserAppPasswordEnc(userEmail)`** (lines 2080-2083): **server-only.** Selects just `app_password_enc`; returns the ciphertext string or `null`. Used by the test route and the whole send pipeline; never exposed to the client.

The underlying `user_email_config` table columns referenced across queries: `user_email` (conflict key), `from_name`, `timezone`, `send_hour_start`, `send_hour_end`, `gap_minutes`, `daily_cap`, `app_password_enc`, `updated_at`, plus `shared_sender_label` / `shared_sender_enabled` for shared senders. (The table is not defined in `migrations/001_initial.sql`.)

#### Encryption (`src/lib/crypto.ts`)

- **Algorithm:** AES-256-GCM.
- **Key:** `sha256(process.env.AUTH_SECRET ?? "genai-scout-dev-key")` (line 5) — derived from `AUTH_SECRET` so no separate env var is needed; falls back to the literal dev key if `AUTH_SECRET` is unset.
- **`encryptSecret(plain)`** (lines 7-13): random 12-byte IV, encrypts, and returns `base64(iv):base64(tag):base64(ciphertext)`.
- **`decryptSecret(payload)`** (lines 15-26): returns `null` for null/empty input; splits on `:`, returns `null` if any of the three parts is missing; verifies the GCM auth tag; on **any** exception (wrong key, tampered ciphertext, bad format) it returns `null` inside a `try/catch` — decryption failures are **silent**.

---

### Key checks & validations

1. **Authentication gate** on all three route methods — no valid session email → `401 { error: "not signed in" }` (GET/PATCH) or the same for the test POST.
2. **App-password presence** — PATCH only writes a new password if it's a non-empty trimmed string; the test route returns `{ ok:false }` if no decryptable password exists; the send pipeline marks emails failed if the sender has no password (see Flows).
3. **Whitespace stripping** — app passwords have all whitespace removed before encryption (`route.ts:27`).
4. **Type gating on PATCH** — `from_name`/`timezone` only accepted as strings; numeric fields only when non-null (then `Number()`-coerced).
5. **Client-side input bounds** — number inputs carry `min`/`max` attributes (hour start 0-23, hour end 1-24, gap ≥1, cap ≥1). These are **not** re-validated server-side.
6. **Test button gating** — "Send test email" is disabled unless `cfg.hasPassword` is already true.
7. **`hasPassword` derivation** — computed as `!!app_password_enc`; the client only ever learns whether a password exists, never the value.

---

### Flows

**Flow A — First-time setup of your sending email:**
1. User signs in and opens `/settings`. The card fetches `GET /api/user/email-config`.
2. No row exists → config comes back with defaults and `hasPassword: false`. Card renders with the amber border and "⚠ app password required" badge; the test button is disabled.
3. User follows the help box: enables Google 2-Step, creates a Gmail app password, and pastes the 16-char code (spaces OK) into the App password field. Optionally sets From name, Timezone, send window, gap, and daily cap.
4. User clicks "Save sending settings" → `PATCH /api/user/email-config` with the schedule fields plus `app_password`.
5. Server strips whitespace, `encryptSecret`s the password, upserts the row (`app_password_enc` + settings + `updated_at`), and returns the refreshed client-safe config.
6. Card updates: `hasPassword: true`, badge flips to "✓ app password set", amber styling clears, the password field is cleared, and the test button becomes enabled. Toast "Sending settings saved."

**Flow B — Testing the connection:**
1. With a saved password, user clicks "Send test email" → `POST /api/user/email-config/test`.
2. Server reads the encrypted password, decrypts it, loads `from_name`, and calls `sendEmailAs` to `smtp.gmail.com:465`, sending "GenAI Scout — test email ✅" to the user's own address.
3. Success → `{ ok:true }` → toast "Test email sent to … — check your inbox." The user should see the message arrive.
4. Failure (bad app password, Gmail auth error, network) → `{ ok:false, error }` → toast surfaces the error / "Test failed — double-check your app password."

**Flow C — Changing an existing password:** identical to Flow A but the App password field label shows "(set — type to replace)" and the placeholder is masked dots. Typing a new value and saving replaces the ciphertext; leaving the field blank preserves the existing password (the field is never pre-filled).

**Flow D — How the saved config drives real sends** (`src/app/api/emails/process/route.ts`): the send processor builds a per-sender cache (line 47) of `{ pass: decryptSecret(getUserAppPasswordEnc(email)), fromName, cap: daily_cap }`. For each due email whose `sender_email` is set: if `info.pass` is falsy it marks the email `status:"failed"` with error `"Sender {sender} has no app password set"` and skips (lines 122-125); otherwise it enforces the per-sender `daily_cap` (line 128) and sends via `sendEmailAs` (line 129). The same decrypt-then-send pattern is reused by `src/lib/email/deliver.ts`, the inbox reply route (`src/app/api/inbox/[id]/reply/route.ts`), notification checks, and the watch pipeline. (The send window hours / gap_minutes are consumed by the scheduling layer, not by the processor loop shown here.)

---

### Edge cases & cautions

- **The env/keys reference list is fake status, not live detection.** `set: true/false` in the `CONFIG` array (`page.tsx:20-32`) is hardcoded in source. The "✓ set" / "not set" badges and the per-category "✓ Ready" / "⚠ Action needed" badge reflect literals, **not** the actual `process.env`. A key can show "✓ set" while genuinely missing (or vice-versa). Maintainers must edit the array by hand; it will silently mislead operators otherwise.
- **`AUTH_SECRET` is the encryption key.** If `AUTH_SECRET` changes (or is unset in one environment but set in another), all previously stored `app_password_enc` values become **undecryptable** — `decryptSecret` returns `null`, `hasPassword` still reports `true` (the ciphertext still exists), but sends silently fail with "has no app password set" and the test route reports "No app password saved yet." Rotating `AUTH_SECRET` therefore invalidates every stored Gmail password with no warning on the Settings page.
- **Dev-key fallback.** With no `AUTH_SECRET`, the key derives from the literal `"genai-scout-dev-key"` — passwords encrypted in that state are readable by anyone with the source. Never rely on the fallback in production.
- **`hasPassword` vs. actually-usable password.** `hasPassword` is `!!app_password_enc` — it does not prove the ciphertext decrypts or that the password is still valid at Gmail. A revoked/expired app password will show "✓ app password set" and pass the test-button gate, yet fail at send time. Encourage users to re-run the test email.
- **Can't test an unsaved password.** The test route reads the password from the DB, not the form. If a user types a new password and clicks "Send test email" **without saving first**, it tests the *previously saved* password (or is disabled if none was ever saved). Always save before testing.
- **No server-side range validation.** PATCH will happily store `send_hour_start` > `send_hour_end`, hours outside 0-23, or zero/negative gap/cap. `Number("")` becomes `0` and a non-numeric string becomes `NaN`, either of which is persisted. Downstream scheduling behavior with such values is undefined here.
- **Silent no-op saves.** A malformed PATCH body is caught and treated as `{}` — the request returns 200 with the unchanged config and the user sees "Sending settings saved," even though nothing changed.
- **Test route returns HTTP 200 on the "no password" branch.** It's `{ ok:false }` at status 200, so anything keying off HTTP status (rather than the `ok` field) would treat it as success. The client correctly checks `res.ok` (the JSON field), but the fetch `.catch` maps a *network* failure to `{ ok:false }` with no `error`, yielding the generic "Test failed" toast.
- **`verifyGmail` is dead code.** Despite its "Settings test connection" comment, the test route sends a real email instead. If a lighter no-send verification is ever desired, `verifyGmail` exists but is unwired.
- **Card renders nothing until config loads.** `UserEmailConfigCard` returns `null` while `cfg` is loading or if the GET fails (the fetch swallows errors and never sets `cfg`). A failed/401 GET makes the entire sending-email card silently disappear rather than showing an error.
- **Timezone list is a fixed 13-item allowlist.** If a stored `timezone` is somehow not in `TIMEZONES`, the native `<select>` has no matching `<option>`; the displayed selection would be inconsistent with the stored value. All values written by this page come from the list, so this only bites if a value is set out-of-band.
- **Per-sender daily cap keys off the sending Gmail address and a UTC date bucket** (`process/route.ts:42,128`). The cap the user sets here is enforced per-sender-email per-UTC-day, independent of the user's chosen `timezone` — the cap window is not aligned to the user's local day.

---

## Admin (Shared Senders, Tavily, Suppression, Digest, Wipe)

### Purpose

This area covers the operational "control panel" pieces of GenAI Scout that a maintainer touches occasionally rather than daily:

- **Shared sending identities** — team Gmail mailboxes (e.g. "Zain") that anyone on the team can send outreach *from*, managed centrally with encrypted app passwords.
- **Tavily search API key(s)** — the search provider that powers discovery. Admins can hot-swap / add keys to a rotating pool and watch monthly usage without a redeploy.
- **Suppression list** — domains / authors / URLs to exclude. In practice this is a **discovery-time** filter only (see the cautions).
- **Daily digest** — a once-a-day ops summary email (per-person outreach counts, template richness, top target sites) sent to one recipient with the whole team CC'd, gated by a toggle and fired from the daily cron fan-out.
- **Destructive wipe** — a one-click "delete all discovery data" reset used to start a clean discovery run.

These features are spread across **three** screens, not one:

| Feature | Where the UI lives |
|---|---|
| Shared Senders, Tavily key, Suppression | Admin page tabs — `src/app/admin/page.tsx` |
| Daily digest toggle / recipient / test | Settings page — `src/components/settings/DailyDigestCard.tsx` (rendered by `src/app/settings/page.tsx:46`) |
| Destructive wipe | Home / dashboard page — `src/app/page.tsx:334` (`wipeAndReset`) |

---

### The Admin page shell

File: `src/app/admin/page.tsx`. A single client component (`"use client"`) with an 8-tab `Tabs` layout (`grid-cols-8`, `src/app/admin/page.tsx:312`):

`Direction · All Seeds · Harvesters · Suppression · Logs · API Keys · Shared Senders · Learning`

On mount (`useEffect`, line 171) it fires three loaders in parallel:
- `reload()` — seeds/harvesters/suppression/pipeline runs/learned-sources (via `/api/seeds`, `/api/harvesters`, `/api/suppression`, `/api/pipeline`, `/api/learned-sources`).
- `loadTavilyStatus()` — `GET /api/admin/tavily-key`.
- `loadSharedSenders()` — `GET /api/admin/shared-senders`.

If `reload()` throws it toasts "Failed to load admin data"; the Tavily and shared-sender loaders swallow errors (`.catch(() => …)`) and just render empty.

The three tabs relevant to *this* doc are **API Keys**, **Shared Senders**, and **Suppression**. (Direction/Seeds/Harvesters/Logs/Learning are documented elsewhere.)

---

### Shared Sending Identities

#### What it is

A "shared sender" is a team Gmail mailbox stored as a row in the `user_email_config` table with a `shared_sender_label` set. Any signed-in user can pick an *enabled* shared sender in the emails page's "Send from" picker; the actual outreach is then sent through that mailbox's Gmail SMTP using the stored (encrypted) app password. The person who clicked Send is still CC'd / attributed, so nothing is lost (per the card's own description, `src/app/admin/page.tsx:728-732`).

#### Data model

Backed by `user_email_config` (see `src/lib/db/queries.ts`). Columns that matter here:
- `user_email` (PK / `onConflict` target) — the Gmail address.
- `shared_sender_label` — display name; **its presence is what marks a row as a shared sender** (`getSharedSenders` filters `.not("shared_sender_label","is",null)`, `queries.ts:2111`).
- `shared_sender_enabled` — boolean toggle.
- `app_password_enc` — AES-256-GCM-encrypted Gmail app password; `hasPassword` in the API is just `!!app_password_enc`.

`SharedSenderRow` interface: `{ email, label, enabled, hasPassword }` (`queries.ts:2087`).

Related query helpers in the same file:
- `getSharedSenders()` (2107) — **all** rows with a label (enabled or not) → the Admin management list.
- `getEnabledSharedSenders()` (2120) — only `shared_sender_enabled = true`, returns `{ email, label }` → used by the "Send from" picker (`GET /api/shared-senders`, `src/app/api/shared-senders/route.ts`) and by IMAP reply-matching to recognize the team's own addresses (`src/lib/email/imap.ts:184`).
- `getSharedSenderLabel(email)` (2132) — returns the label even after disabling, so send history still reads "from Zain".
- `getInboxAccounts()` (2091) — separate concept: any row with a password (not necessarily a shared sender) powers the inbox switcher.
- `upsertUserEmailConfig(userEmail, data)` (2068) — the shared upsert used by both POST and PATCH.

#### UI walkthrough — "Shared Senders" tab

`src/app/admin/page.tsx:723-782`.

- **Card header/description** — explains the picker + CC behavior.
- **Empty state** — if `sharedSenders.length === 0`: centered muted text "No shared senders configured yet" (line 736).
- **Per-sender row** (line 737+) — for each configured sender:
  - **Label** (bold) and **email** (muted, truncated).
  - **"no password set" badge** — amber, shown only when `!s.hasPassword` (line 744). Signals the mailbox can't actually send until a password is added.
  - **Enable/disable `Switch`** — `checked={s.enabled}`, disabled while a toggle is in flight (`togglingSender === s.email`). `onCheckedChange` → `toggleSender(s)`.
  - **App-password input + Update button** — a `type="password"` field bound to `senderPwInputs[s.email]`; Enter or the "Update" button calls `saveSenderPassword(s.email)`. Update is disabled when the input is blank or a save is in flight; shows a spinner while saving.
- **Separator**, then **"Add a shared sender"** form (line 767+): three inputs — Display name (`label`), Gmail address (`email`), App password (`app_password`) — plus an "Add" button. Add is disabled unless all three are non-empty (or while `addingSender`). Submits via `addSharedSender()`.

Client handlers:
- `toggleSender` (line 98) → `PATCH /api/admin/shared-senders/{email}` with `{ enabled: !s.enabled }`, toasts, reloads.
- `saveSenderPassword` (line 109) → `PATCH …/{email}` with `{ app_password }`; on success clears the input and reloads; on failure toasts "Failed to update password."
- `addSharedSender` (line 127) → `POST /api/admin/shared-senders` with `{ email, label, app_password }`; on success resets the form + reloads; on failure toasts the server's `error` (or "Failed to add.").

#### API routes

**`GET /api/admin/shared-senders`** — `src/app/api/admin/shared-senders/route.ts:6`. No body/params. Returns `getSharedSenders()` (array of `SharedSenderRow`). No explicit auth in the handler (see cross-cutting auth section).

**`POST /api/admin/shared-senders`** — same file, line 11. Body `{ email, label, app_password }`.
- Validation: if any of the three is falsy → **400** `{ error: "email, label, and app_password are required" }`.
- Core: `upsertUserEmailConfig(email, { shared_sender_label: label, shared_sender_enabled: true, app_password_enc: encryptSecret(app_password_with_whitespace_stripped) })`. Whitespace is stripped from the password (`.replace(/\s+/g, "")`) — Gmail app passwords are shown with spaces, so this normalizes them.
- Success → **201** `{ ok: true }`.
- Any thrown error → **500** `{ error: e.message }`.
- Note: because it's an upsert on `user_email`, POSTing an existing email **overwrites** its label/enabled/password rather than erroring on duplicate.

**`PATCH /api/admin/shared-senders/[email]`** — `src/app/api/admin/shared-senders/[email]/route.ts:7`. `email` is a path param (URL-encoded on the client via `encodeURIComponent`, then `decodeURIComponent`'d on the server, line 17). Body may contain any of `{ enabled?: boolean; app_password?: string; label?: string }`.
- Builds a partial `patch`:
  - `enabled` applied only if it's a real boolean.
  - `label` applied only if it's a non-empty string (trimmed).
  - `app_password` applied only if a non-empty string; stored as `encryptSecret(pw.replace(/\s+/g, ""))`.
- Calls `upsertUserEmailConfig(email, patch)`. **This is an upsert, not a guarded update** — see edge cases.
- Success → `{ ok: true }`. Thrown error → **500** `{ error: e.message }`.
- Body parsing is defensive: `req.json().catch(() => ({}))`, so a malformed body yields an empty patch (a no-op upsert of just `user_email` + `updated_at`).

**`GET /api/shared-senders`** (note: NOT under `/admin`) — `src/app/api/shared-senders/route.ts`. Returns `getEnabledSharedSenders()` (`{ email, label }[]`) for the "Send from" picker. Any signed-in user; no passwords exposed.

#### Flows

1. **Add a shared sender:** Admin fills name/email/password → `addSharedSender` → `POST /api/admin/shared-senders` → `upsertUserEmailConfig` writes an enabled row with an encrypted password → list reloads; the sender is immediately eligible in the emails "Send from" picker.
2. **Rotate a Gmail app password:** Admin types the new password in a sender's row → `saveSenderPassword` → `PATCH …/{email}` with `{ app_password }` → re-encrypted and stored → "no password set" badge clears if it was showing.
3. **Temporarily disable a mailbox:** toggle the Switch → `PATCH …/{email}` `{ enabled: false }` → the sender disappears from `getEnabledSharedSenders`, so it's no longer offered in the picker, but it stays in the admin list and its label still resolves for historical sends.

#### Edge cases & cautions (shared senders)

- **PATCH-by-email is an upsert, not an update.** `upsertUserEmailConfig` upserts on `user_email`. PATCHing an email that has **no** existing row will silently *create* a bare `user_email_config` row (e.g. a typo'd email creates a junk row). There's no existence check.
- **No password validation.** The app password is stored as-is (whitespace-stripped) and encrypted; there's no test-send to verify it actually authenticates with Gmail. A wrong password only surfaces later at send time.
- **`app_password` in PATCH is only applied if non-empty** — you can never clear a password back to null via this endpoint, only replace it.
- **Enabling a sender with no password** is possible (the toggle and the password are independent). The "no password set" amber badge is the only guard; the picker will still offer it, and sends would fail.
- **Encryption key is derived from `AUTH_SECRET`** (`src/lib/crypto.ts:5`). If `AUTH_SECRET` changes, every stored `app_password_enc` becomes undecryptable (`decryptSecret` returns `null`), silently breaking all shared-sender sends until passwords are re-entered.
- **Delete a shared sender:** there is **no delete endpoint/UI** for shared senders — you can only disable them. Removing one entirely requires a direct DB edit.

---

### Tavily Search API Key(s)

#### What it is

Tavily is the web-search provider behind discovery. It has no usage API, so the app counts calls itself in Redis per calendar month and manages **a rotating pool of keys**. The Admin "API Keys" tab lets you add keys and watch per-key + aggregate monthly usage, so you can top up before the free-tier quota (1,000 searches/mo **per key**) runs out. Changes take effect immediately, no redeploy.

Backing module: `src/lib/search/tavilyUsage.ts`. Consumed at search time by `src/lib/search/webSearch.ts`.

#### Backend model (`src/lib/search/tavilyUsage.ts`)

- **Per-key monthly limit:** `PER_KEY_LIMIT = Number(process.env.TAVILY_MONTHLY_LIMIT || 1000)` (line 7).
- **Redis keys:**
  - `tavily:count:YYYY-MM` — global tally across all keys (line 9).
  - `tavily:count:YYYY-MM:{id}` — per-key tally (line 10).
  - `tavily:error` — last hard error `{ detail, at }`, 24h TTL (line 11, 156-160).
  - `tavily:key_override` — **legacy** single-key override, still honored as a fallback (line 12).
  - `tavily:pool` — JSON array of `PoolEntry { id, enc, label?, exhaustedMonth? }` (line 13, 22).
  - `ENV_ID = "env"` — synthetic id representing the `TAVILY_API_KEY` env-var fallback.
- **Add a key** — `addTavilyKey(key, label?)` (line 50): trims, **skips exact duplicates** (decrypts each pool entry to compare), otherwise pushes `{ id, enc: encryptSecret(key), label }` with a random base36 id.
- **Remove** — `removeTavilyKey(id)` (line 58): filters the pool.
- **List** — `listTavilyKeys()` (line 66): returns `PoolKeyStatus { id, label, masked, active, exhaustedThisMonth, used }`. `masked` shows `first6…last4` (or `••••` for short keys). `active = !exhaustedThisMonth`.
- **Key selection** — `getActiveTavilyKey(reserve=false)` (line 78): among non-exhausted pool entries, picks the **least-used this month** (stable tiebreak on pool order). If the pool is empty/all-exhausted, falls back to the legacy `tavily:key_override`, then to `process.env.TAVILY_API_KEY` (both under id `env`). When `reserve=true`, it atomically `INCR`s the chosen key's per-key counter *at selection time* so concurrent callers see it as more-used and spread out (fixes least-used balancing under concurrency). Only search callers reserve.
- **Exhaustion** — `markTavilyKeyExhausted(id)` (line 61): stamps `exhaustedMonth = "YYYY-MM"`. A key flagged exhausted is dropped from rotation **for the current month only**; it auto-recovers when the month rolls over (quota renewal). Triggered from `webSearch.ts:51` on HTTP 402/429/432 responses.
- **Counting** — `trackTavilyCall()` (line 147) bumps the global tally (per-key already done at reserve). Called fire-and-forget from `webSearch.ts:38`.
- **Error flag** — `flagTavilyError(detail)` (line 156): set from `webSearch.ts:56` on statuses 401/402/403/429/432.
- **Legacy override helpers** — `setTavilyKeyOverride` / `clearTavilyKeyOverride` / `hasTavilyKeyOverride` (lines 114-132) still exist and reset usage on set/clear, but **the current admin route does not call them** (they only serve as the `getActiveTavilyKey` fallback). See the mismatch caution.
- **Reset** — `resetTavilyUsage()` (line 134): deletes the global tally, the error flag, and every per-key tally (pool + `env`).

#### Usage summary — `getTavilyUsage()` (line 175) → `TavilyUsage`

- `enabled` — true if `TAVILY_API_KEY` env is set **or** the pool has any keys.
- `used` — global monthly count.
- `limit` — **aggregate** capacity = `poolActive × PER_KEY_LIMIT` (e.g. 4 active keys → 4,000). With no pool, it's a single `PER_KEY_LIMIT`.
- `perKeyLimit` — the per-key ceiling (default 1,000).
- `over` — with a pool: `poolActive === 0`; without: `used >= limit`.
- `near` — with a pool: `poolActive <= 1 && !over` (i.e. down to your last key); without: `used >= 90% of limit`.
- `poolTotal` / `poolActive`, plus a `perKey[]` breakdown.
- If Redis is unconfigured, returns zeros but still reports `enabled`/`limit`.

#### UI walkthrough — "API Keys" tab

`src/app/admin/page.tsx:643-721`.

- **Card title/description** — "Tavily Search API Key"; notes the free tier (1,000 searches/mo) and that swaps are instant.
- **Status row** (shown once `tavilyStatus` loads, line 654):
  - A colored **usage badge**: muted "Not configured" when `!usage.enabled`; else `${used}/${limit} used this month` colored red (over) / amber (near) / green (ok).
  - A second badge reading `"Using an admin-set override key"` vs `"Using the TAVILY_API_KEY environment variable"` driven by `tavilyStatus.hasOverride` (**note: the GET route never returns `hasOverride`** — see caution).
  - If `usage.error` is present, a red "Last error: …" line.
- **Per-key breakdown** (line 673, only if `keys.length > 0`): a bordered list headed "N keys in the rotating pool · searches go to the least-used active key". Each row shows the masked key, optional label, a usage bar (green / amber ≥90% / red if exhausted), a `used/limit` count, and an "active"/"exhausted" tag.
- **Add-key input + Save** (line 695): a `type="password"` field (`tvly-…`). Enter or "Save" → `saveTavilyKey()`. Save is disabled when blank or while saving (spinner shown).
- **"Revert to env var" button** (line 707): rendered **only when `tavilyStatus?.hasOverride`** → `clearTavilyKey()`.
- **Footer note** (line 714): link to tavily.com and a claim that "Saving resets the usage counter" (inaccurate under the pool model — see caution).

Client handlers:
- `loadTavilyStatus` (line 53) → `GET /api/admin/tavily-key`.
- `saveTavilyKey` (line 58) → `POST /api/admin/tavily-key` with `{ key }`; on `res.ok` toasts and reloads status; else toasts "Failed to save key."
- `clearTavilyKey` (line 76) → `DELETE /api/admin/tavily-key` (no query string); **always** toasts success regardless of the response, then reloads.

#### API routes — `src/app/api/admin/tavily-key/route.ts`

**`GET`** (line 5): returns `{ keys: listTavilyKeys(), usage: getTavilyUsage() }` (run in parallel). **Does not return `hasOverride`** despite the client type expecting it.

**`POST`** (line 11): accepts `{ key, label? }` **or** `{ keys: "a\nb\nc" }`. Splits the raw string on whitespace/commas, trims, drops empties.
- No parts → **400** `{ error: "key required" }`.
- For each part: `addTavilyKey(part, label if single)`. Success → `{ ok: true, added: N, keys: [...] }`.
- Thrown error → **500** `{ error }` (e.g. Redis unconfigured, since `writePool` throws "Redis not configured — can't store Tavily keys").
- **Does not reset usage** — it only appends to the pool (and dedupes exact matches).

**`DELETE ?id=`** (line 26): requires `?id=` query param. Missing → **400** `{ error: "id required" }`. Else `removeTavilyKey(id)` → `{ ok: true, keys: [...] }`.

#### Flows

1. **Top up capacity:** paste one or more keys → Save → `POST` appends to pool → per-key breakdown now shows them; aggregate `limit` rises by `PER_KEY_LIMIT` per active key.
2. **A key hits quota mid-run:** `webSearch.ts` gets a 402/429/432 → `markTavilyKeyExhausted(id)` drops it from rotation this month; other keys keep serving. On month rollover the flag clears automatically.
3. **Remove a dead key:** (no per-key delete button exists in the current UI) — would require `DELETE ?id=` directly.

#### Edge cases & cautions (Tavily)

- **The UI still reflects an older single-"override" design and is partially wired wrong against the current pool backend:**
  - The **GET route does not include `hasOverride`**, so `tavilyStatus.hasOverride` is always `undefined`/falsy. Consequence: the status badge **always** reads "Using the TAVILY_API_KEY environment variable", and the **"Revert to env var" button never renders**.
  - `clearTavilyKey` calls `DELETE /api/admin/tavily-key` **with no `?id=`**, which the route answers with **400 `{ error: "id required" }`** — but the client ignores the response and toasts success anyway. So even if the button appeared, it wouldn't revert anything.
  - The footer note "Saving resets the usage counter" is inaccurate: `POST` calls `addTavilyKey` (append), not `setTavilyKeyOverride` (which is what used to reset usage). Adding a key does **not** reset the global counter.
  - There is **no per-key remove control** in the UI even though the `DELETE` endpoint supports it.
- **All Tavily state lives in Redis.** With Redis unconfigured: `POST` throws → 500 ("can't store Tavily keys"); usage returns zeros; and search silently falls back to the `TAVILY_API_KEY` env var only.
- **Counting is best-effort / fire-and-forget** (`void trackTavilyCall()`), so the displayed usage can under-count if Redis hiccups. It is not authoritative billing data.
- **Keys are stored encrypted** with the same `AUTH_SECRET`-derived key as app passwords; the API only ever returns masked forms.
- **`over`/`near` semantics differ with vs without a pool** — with a pool the banner judges headroom by *remaining active keys*, not raw count, so "used/limit" can look far from full yet still flag "near" when you're on your last key.

---

### Suppression List

#### What it is

A list of `domain` / `author` / `url` values to exclude. The card describes it as "Domains and authors excluded from results and exports," but in the actual code path it is applied **only during discovery** (host-based), so treat it as a **discovery-only filter** (see cautions).

Type: `Suppression { id, type: "domain"|"author"|"url", value, reason?, added_at }` (`src/lib/types.ts:160`). Table: `suppression`.

#### UI walkthrough — "Suppression" tab

`src/app/admin/page.tsx:784-823`.

- **Header/description** — "Domains and authors excluded from results and exports."
- **Add row** (line 792): a native `<select>` (Domain / Author / URL — note: the `newSupprType` state is typed `"domain" | "author"` at line 43, but the select also offers a `url` option, line 800), a value `Input` ("e.g. spamsite.com"), an optional reason `Input`, and an "Add" button.
- **Separator**, then the **list** (max-height, scrollable). Empty state: "No suppressions yet". Each entry shows a type badge, the value (truncated), an optional reason (hidden on small screens), and an `X` remove button.

Client handlers:
- `addSuppression` (line 257): no-op if value is blank; else `POST /api/suppression` with `{ type, value, reason }`, clears inputs, toasts "Added to suppression list", reloads.
- `removeSuppression` (line 270): `DELETE /api/suppression` with `{ id }`, then optimistically filters it out of local state.

#### API routes — `src/app/api/suppression/route.ts`

- **`GET`** (line 4): `getSuppressions()` → all rows ordered by `added_at desc` (`queries.ts:379`). Throws propagate as an unhandled 500.
- **`POST`** (line 9): body `{ type, value, reason }`. If `type` or `value` missing → **400** `{ error: "type and value required" }`. Else `addSuppression(type, value, reason)`. `addSuppression` (`queries.ts:385`) does an **upsert on `value`** with `ignoreDuplicates: true` — so adding a duplicate value is a silent no-op (and note: dedup is keyed on `value` alone, ignoring `type`). Returns `{ ok: true }`.
- **`DELETE`** (line 16): body `{ id }`. Missing → **400** `{ error: "id required" }`. Else `deleteSuppression(id)` (`queries.ts:391`) → `{ ok: true }`.

#### How suppression is actually applied

The only consumer is the discovery pipeline. `processHit` (`src/lib/pipeline/run.ts:655`) calls `isSuppressed(host)` at line 659 and **returns early (skips the hit) if suppressed** — before fetching/parsing the article. Notably it returns *without* marking the hit processed.

`isSuppressed(host, authorName?)` (`queries.ts:395`) builds `checks = [host]` (+ `authorName` if provided) and queries `suppression` for **any row whose `value` is in `checks`, regardless of `type`** (`.in("value", checks)`).

#### Edge cases & cautions (suppression)

- **Discovery-only, despite the "results and exports" copy.** The only call site is `processHit`. There is no suppression filtering in the results list, exports, or email flows — a suppressed author/domain that is *already* in the DB (added before suppression, or via manual add) will still appear in results and exports.
- **`type` is not enforced at match time.** `isSuppressed` matches on `value` only. So:
  - A **`domain`** suppression works only if its `value` exactly equals the article host (e.g. `spamsite.com`). A bare domain won't match `www.spamsite.com` or subdomains.
  - An **`author`** suppression is **effectively inert** in the pipeline: `processHit` calls `isSuppressed(host)` **without** an author name, so author values are never in `checks`.
  - A **`url`** suppression is likewise inert: the check compares against `host`, not the full URL, so a full-URL value will never match.
- **Dedup ignores type.** `addSuppression` upserts on `value` with `ignoreDuplicates`, so you can't have the same string suppressed under two types, and re-adding is a silent no-op (no error, no toast difference).
- **Suppressed hits aren't marked processed.** Because `processHit` returns before `markHitProcessed`, a suppressed URL can be re-evaluated on subsequent runs (cheap, but worth knowing).

---

### Daily Digest

#### What it is

A once-a-day ops summary email. Config (on/off + recipient) lives in Redis so it's editable and the nightly send can be toggled without a deploy. Module: `src/lib/digest/daily.ts`.

Config: `DigestConfig { enabled, recipient }`. Default: `{ enabled: true, recipient: "zain@imagine.art" }` (`daily.ts:10`). Stored in Redis under `digest:daily`.
- `getDigestConfig()` (line 14): reads Redis; falls back to `DEFAULT` if Redis is unconfigured or the key is missing/corrupt. Treats `enabled` as true unless explicitly `false`.
- `setDigestConfig(patch)` (line 22): **throws "Redis not configured" if Redis is missing**; merges over current, trims recipient, writes back, returns the new config.

#### UI walkthrough — Settings "Daily digest email" card

`src/components/settings/DailyDigestCard.tsx` (rendered at `src/app/settings/page.tsx:46`). **This card is on the Settings page, not the Admin page.**

- On mount, `GET /api/digest/settings` populates the toggle + recipient.
- **"Send the daily digest" Switch** — `onCheckedChange` immediately `save({ enabled })` (PUT). Disabled until loaded / while saving.
- **Recipient input + Save** — email field; Save (disabled if blank/saving) → `save({ recipient })`.
- **"Send a test now" button** — `sendTest()` → `POST /api/digest/daily?force=1`; on `d.sent` toasts "Test digest sent to {recipient}", else toasts `d.error ?? d.skipped ?? "Couldn't send."`. Disabled if recipient is blank.

#### What the digest contains — `buildDailyDigest()` (`daily.ts:31`)

Pulls all `outreach_emails` rows where `kind = "initial"` (fields: sender_email, status, template_id, body, replied_at, success_at, author_id) and computes a plain-text report:
- **Per-person counts** keyed by `sender_email` (fallback label "(server default)"): `scheduled`, `sent`, `replied` (has `replied_at`), `won` (has `success_at`).
- **Template richness:** count template-backed (`template_id` set) vs "AI-generated (no template)"; average body length; how many look "thin" (`< 300` chars).
- **Website usage:** among authors with status `sent`/`scheduled`, resolves each author's `primary_domain_id` → `domains.host` and tallies the top 10 target sites. (Author and domain lookups are capped at 1,000 ids each via `.slice(0, 1000)`.)
- **Totals:** total scheduled + total sent.
- Returns `{ subject: "Outreach digest — N scheduled, M sent", text }`.

#### Sending — `sendDailyDigest(force=false)` (`daily.ts:99`)

1. Reads config. If `!enabled && !force` → `{ sent: false, skipped: "disabled" }`.
2. If no recipient → `{ sent: false, skipped: "no recipient" }`.
3. Builds the digest.
4. **CC every team member:** loads all `user_email_config.user_email` values, lowercases/dedupes, keeps ones containing `@` and not equal to the recipient — these become the CC list (`daily.ts:104-106`).
5. Sends via `sendEmail({ to: recipient, cc, subject, body })` (`src/lib/email/smtp.ts`).
6. Returns `{ sent: true, recipient, cc: count }` on success, or `{ sent: false, error, recipient, cc }` on failure (SMTP errors are caught, not thrown).

#### API routes

**`GET/PUT /api/digest/settings`** — `src/app/api/digest/settings/route.ts`.
- `GET` → `getDigestConfig()`.
- `PUT { enabled?, recipient? }` → applies only fields of the right type (`enabled` must be boolean, `recipient` a string), then `setDigestConfig` → returns new config. Errors → **500** `{ error }`. No auth check in the handler (relies on the proxy).

**`POST/GET /api/digest/daily`** — `src/app/api/digest/daily/route.ts`. `maxDuration = 120`. `GET` just calls `POST`.
- **Auth:** `authorized(req)` (line 8) — if `CRON_SECRET` is unset, allow all; else allow if `Authorization: Bearer <secret>` **or** `?key=<secret>` **or** any valid session (`auth()`). Otherwise **401** `{ error: "unauthorized" }`.
- `?dry=1` → returns `{ dry: true, subject, text }` **without sending** (preview).
- `?force=1` → `sendDailyDigest(true)` (sends even if the toggle is off — this is what the "Send a test now" button uses).
- Default → `sendDailyDigest(false)`.
- Thrown errors → **500** `{ error }`.

#### Cron wiring — the "midnight cron"

The digest is fired from the daily cron fan-out route `src/app/api/cron/daily/route.ts` (line 38: `hit("/api/digest/daily")`), which also triggers the link audit, page-health scan, email finder, and notifications check. That fan-out uses `APP_URL`/`NEXTAUTH_URL` + `CRON_SECRET`.

**Important scheduling nuance:** `vercel.json` declares **only one** cron — `/api/emails/process` at `0 13 * * *` (13:00 UTC). `/api/cron/daily` is **not** in `vercel.json`, so the digest's actual daily trigger depends on an **external scheduler / Upstash QStash** hitting `/api/cron/daily` (or `/api/digest/daily` directly) with the `CRON_SECRET`. The code comment calls it the "midnight cron," but the repo's committed cron config does not schedule it — a maintainer must ensure that external trigger exists, or the digest will only ever send via the manual "Send a test now" button.

#### Edge cases & cautions (digest)

- **Toggle default is ON** (`enabled: true`) — a fresh install with no Redis config will attempt to send to the hard-coded default `zain@imagine.art` whenever the cron fires.
- **`setDigestConfig` requires Redis.** Saving from the Settings card throws if Redis is unconfigured; the card then toasts "Save failed."
- **CC list is derived from `user_email_config`** — anyone with a row (including junk rows accidentally created via the shared-sender PATCH-upsert bug) gets CC'd on the digest. Rows without a valid `@` are filtered, and the primary recipient is de-duped out.
- **Counts are over `kind = "initial"` outreach only** — follow-up emails don't count toward scheduled/sent totals.
- **`force=1` sends to the configured recipient**, not to the person clicking — the "test" is a real digest to whoever is set as recipient (plus the whole team CC).

---

### Destructive Wipe

#### What it is

A "delete all discovery data and start fresh" button. **Its UI is on the home/dashboard page, not the Admin page** (`src/app/page.tsx:334`, `wipeAndReset`).

#### UI walkthrough

- Triggered by a wipe button (state `isWiping`) that first shows a **native `confirm()`**: *"This will permanently delete ALL articles, authors, scores, and discovery hits. Seed tools and harvester config are kept. Continue?"* (line 335). Cancel aborts.
- On confirm → `POST /api/admin/wipe`. On `data.ok` toasts "Database wiped — ready for a fresh discovery run." and resets local dashboard state (prospects, totals, stats, hit counts) + reloads run history. On failure toasts the raw JSON / error.

#### API route — `src/app/api/admin/wipe/route.ts`

**`POST /api/admin/wipe`**:
- **Auth:** `auth()` — if no `session.user` → **401** `{ error: "Unauthorized" }`. (This is the one route in this area that checks auth in-handler; note it's any signed-in user, **no admin role**.)
- Defines `wipe(table)` = `supabaseAdmin.from(table).delete().not("id", "is", null)` — i.e. delete **every** row (the `.not("id","is",null)` predicate matches all rows, satisfying Supabase's "no unfiltered delete" guard). On error it logs a warning and returns `false` (does **not** throw / abort the rest).
- Deletes in FK-dependency order (line 18-25): `scores → mentions → links → contacts → article_authors → articles → authors → domains → discovery_hits`.
- Always returns **200** `{ ok: true, results: { table: boolean, … } }`, where each boolean indicates that table's delete succeeded.

#### What is deleted vs preserved

- **Deleted:** `scores`, `mentions`, `links`, `contacts`, `article_authors`, `articles`, `authors`, `domains`, `discovery_hits` — the entire discovered-writer dataset, including any manually-added prospects and their contacts.
- **Preserved (not touched):** seed tools (`seeds`), harvester config, `suppression`, `pipeline_runs`, `user_email_config` (shared senders / app passwords), `outreach_emails`, campaigns, learned sources, Tavily/Redis state, digest config.

#### Edge cases & cautions (wipe)

- **Irreversible and total.** There is no soft-delete, no backup, no per-table selection — every row in the nine discovery tables is deleted. The only guard is the browser `confirm()` dialog.
- **Any signed-in user can do it.** The route requires a session but **no admin/role check** — every authenticated team member has the wipe button and endpoint.
- **Partial-failure is possible and always reports 200.** If one table's delete errors (e.g. a lingering FK constraint or a transient DB error), `wipe()` logs `[wipe] <table>: <msg>` server-side, sets that table's result `false`, and **continues** — the response is still `{ ok: true, … }` with `ok:true`. The client only checks `data.ok`, so it will toast success even if some `results.*` are `false`. Inspect the `results` map to detect a partial wipe.
- **`contacts` are collateral.** Enriched emails / manually-added prospects live in the wiped tables, so a wipe throws away enrichment work (Blitz credits already spent, manual entries), not just crawled data.
- **Outreach history survives** (`outreach_emails` is not wiped) but the `authors` it references are deleted, so post-wipe the digest's "website usage" and any author joins can dangle.

---

### Cross-cutting: authentication & permissions

- **App-wide gate:** `src/proxy.ts` (Next.js proxy, matcher excludes static assets) redirects any request without a session to `/login`, **except** `/api/auth/*`, `/api/health`, and requests carrying the `CRON_SECRET` (Bearer or `?key=`). So every Admin route is reachable only by a signed-in user *or* a cron-secret caller.
- **No role/admin authorization anywhere in this area.** Any authenticated team member can manage shared senders + passwords, add/remove Tavily keys, edit the suppression list, change digest config, and **wipe the database**. There is no "is this user an admin" check.
- **In-handler auth is inconsistent:** only `/api/admin/wipe` (session) and `/api/digest/daily` (cron-or-session) check auth themselves. `/api/admin/shared-senders`, `/api/admin/shared-senders/[email]`, `/api/admin/tavily-key`, `/api/suppression`, and `/api/digest/settings` have **no in-handler auth** — they rely entirely on the proxy. Consequence: a caller holding `CRON_SECRET` (which the proxy waves through for *all* paths) can hit those admin endpoints without a session, e.g. add/rotate a shared-sender password or change Tavily keys.

### Secrets at rest — `src/lib/crypto.ts`

- App passwords and Tavily keys are encrypted with **AES-256-GCM**, key = `sha256(AUTH_SECRET || "genai-scout-dev-key")`. Format `base64(iv):base64(tag):base64(ciphertext)`.
- `decryptSecret` returns `null` on any failure (bad format, wrong key/tag) rather than throwing.
- **Caution:** rotating `AUTH_SECRET` invalidates every stored secret (app passwords and pooled Tavily keys) — they'll silently decrypt to `null`, breaking sends and search until re-entered. The dev fallback key means secrets encrypted locally without `AUTH_SECRET` set are effectively unprotected.

---

## Cross-Cutting Backend Flows, Checks & Edge Cases

### Purpose

This section documents the **automated outreach engine** — the background machinery that runs GenAI Scout's email program without a human in the loop, plus the safety checks woven through it. It is meant to be the one place a reader can understand the whole loop end-to-end:

- A single scheduled endpoint (`POST /api/emails/process`) that, on every tick, does four things in order: (1) detects inbound replies over IMAP, (2) auto-negotiates any AI-managed threads that have a new reply, (3) schedules automatic no-reply follow-ups, and (4) sends any scheduled emails whose time has arrived.
- The IMAP reply-detection subsystem that classifies inbound mail (real reply vs. bounce vs. autoresponder), attributes it to the correct thread, and is idempotent.
- The two-layer **contacted / dedup model** that prevents emailing the same person (or the same shared inbox) twice across campaigns.
- **Role/generic address parking** (`press@`, `info@`, `no-reply@`, …) so the engine never pitches a non-person mailbox.
- **Smart scheduling** that lands every send inside the recipient's local business-hours window while respecting spacing and a daily cap.
- The **daily digest cron** fan-out and **CSV export** endpoints.

The engine is designed to be *fully automatic but safe*: every automated action has a guard in front of it, and this section ends with a consolidated **Checks & Cautions** table listing every guard, what it protects, and how it can be bypassed.

Anchor files:
- `src/app/api/emails/process/route.ts` — the every-tick engine
- `src/lib/email/imap.ts` — reply detection + classification
- `src/lib/email/followup.ts` — auto follow-up generation/scheduling
- `src/lib/email/roleEmail.ts` — role/generic address detector
- `src/lib/email/schedule.ts` — smart scheduling math
- `src/lib/email/deliver.ts` — identity-aware delivery
- `src/lib/email/smtp.ts` — nodemailer transports
- `src/lib/negotiation/run.ts`, `src/lib/negotiation/settings.ts` — auto-negotiation
- `src/lib/redis.ts` — distributed lock + daily-cap counters
- `src/app/api/cron/daily/route.ts` — once-a-day fan-out
- `src/app/api/digest/daily/route.ts` — ops digest
- `src/app/api/export/route.ts`, `src/app/api/workflows/[id]/export/route.ts` — CSV/JSON export
- `src/lib/db/queries.ts` — the DB primitives (`getDueEmails`, `addressHasOtherSentInitial`, `recordReplyOnAnchor`, `getContactedAuthorIds`, `getOutstandingSentForReplyCheck`, `scheduleWorkflowEmails`, and more)

---

### The engine: `POST /api/emails/process`

File: `src/app/api/emails/process/route.ts`.

**Methods / path.** `POST /api/emails/process` and `GET /api/emails/process` (GET simply calls POST at line 191-193, because Vercel Cron / QStash may issue either verb). `export const maxDuration = 300` (5-minute serverless budget).

**Who triggers it.**
- **Vercel Cron** — `vercel.json` declares exactly one cron: `{ path: "/api/emails/process", schedule: "0 13 * * *" }` (once/day at 13:00 UTC). This is the Hobby-plan fallback.
- **Upstash QStash** — a `~30-minute` schedule configured *externally* in the QStash dashboard (the route header comment at lines 27-30 describes this cadence; it is not declared in `vercel.json`). This is what gives timezone-accurate delivery.
- **Manual "Process now" button** — the Sending page (`src/app/sending/page.tsx:176`) and the Negotiation page (`src/app/negotiation/page.tsx:145`) both `fetch("/api/emails/process", { method: "POST" })`. This lets a signed-in user force reply-detection + auto-negotiation + send-due on demand.

**Authorization** — `authorized(req)` (lines 17-25):
1. If `process.env.CRON_SECRET` is unset → **return `true`** (open; local dev).
2. If header `Authorization: Bearer <CRON_SECRET>` matches → true (Vercel Cron and QStash both send this).
3. If `?key=<CRON_SECRET>` matches → true.
4. Else, if there is a valid app session (`await auth()`) → true (the manual button).
5. Otherwise → `401 { error: "unauthorized" }`.

**Concurrency lock** (lines 36-40). Builds a unique `lockToken` (`Date.now()-random`) and calls `acquireLock("lock:emails:process", 290, lockToken)`. If another run holds it → returns `200 { skipped: "another send run is in progress" }` and does nothing. The lock TTL is **290s** (just under `maxDuration`), so a crashed run never deadlocks. Released in a `finally` (line 186) via `releaseLock` (a Lua compare-and-delete so it only frees a lock it still owns).
> With no Redis configured (`redis()` returns null), `acquireLock` returns `true` unconditionally (`src/lib/redis.ts:27`) — i.e. local dev is treated as a single instance, but two concurrent triggers would **not** be de-duplicated.

**Per-sender credential cache** (lines 44-51). `senderCache: Map<email, { pass, fromName, cap }>`. `senderInfo(email)` lazily loads and decrypts the sender's Gmail app password (`getUserAppPasswordEnc` → `decryptSecret`) plus their `from_name` and `daily_cap` (`getUserEmailConfig`). Cached for the duration of one run (a password changed mid-run is not re-read — minor staleness).

**`day`** (line 42) = `new Date().toISOString().slice(0,10)` — the **UTC** date bucket used for the daily-cap counter.

#### Order of operations inside the run

**Step 1 — Reply detection (read-only, runs first).** Lines 60-64. Dynamically imports and calls `runReplyDetection()` (see the IMAP section). It runs **before** the send loop deliberately, so a follow-up that is due *right now* sees the freshest reply status and the send-time guards can park it. Any thrown error is caught and pushed to `replies.errors`; **reply-detection failure never blocks sending.**

**Step 2 — Send the due queue.** `const due = await getDueEmails(50)` (line 66) — up to 50 scheduled emails whose `scheduled_at <= now`. For each `email`, in order:

| # | Condition (line) | Action | Counter |
|---|---|---|---|
| a | `!email.recipient` (69-73) | `status: failed`, `error: "No recipient email address"` | `failed++` |
| b | `isRoleEmail(email.recipient)` (77-81) | `status: failed`, `error: "Skipped: generic/role address (not a person)"`, `followup_skipped: true` | *(not counted in failed)* |
| c | Send-time dup guard — **initials only** (90-95): `!isThreadReply && !recipient_override && addressHasOtherSentInitial(recipient, id)` | `status: failed`, `error: "Skipped: recipient inbox already contacted in another campaign"`, `followup_skipped: true` | `dupSkipped++` |
| d | Follow-up parent already engaged (108-116): `kind === "followup" && (parent.replied_at || parent.success_at)` | **Park, don't fail:** `status: draft`, `scheduled_at: null` | *(none)* |
| e | `sender` present but `!info.pass` (122-126) | `status: failed`, `error: "Sender X has no app password set"` | `failed++` |
| f | Daily cap hit (128): `getDailyCount(sender, day) >= info.cap` | `continue` — **no status change; stays `scheduled`** for a later run | `cappedSkipped++` |
| g | Send OK (135-139) | `status: sent`, `sent_at`, `message_id: res.messageId`; `incrDailyCount(sender ?? workflow_id, day)` | `sent++` |
| h | Send failed (140-143) | `status: failed`, `error: res.error` | `failed++` |

Notes on the send path:
- `isThreadReply` (line 82) = `kind === "followup" || kind === "negotiation"`. These are exempt from the role check? No — the role check runs on *every* due email. They are exempt from the **dup guard** (case c) because they legitimately reuse an already-emailed inbox within their own thread.
- **CC attribution** (lines 99-101): `sentBy = sent_by_email`; if `sentBy !== sender` (a shared-inbox send), `sentBy` is CC'd so the person who clicked Send sees replies.
- **Threading** (lines 107-118): for follow-ups/negotiations, `getFollowupParent(parent_id)` supplies the parent's `message_id` as `inReplyTo`/`references`, so the send threads into the original conversation. A `kind === "followup"` nudge is **parked** if the parent has since replied or converted (case d); a `kind === "negotiation"` reply is the opposite — it is our answer *to* their reply, so it always proceeds.
- **Identity** (lines 120-133): if `sender_email` is set → `sendEmailAs` (that user's own Gmail app password). Otherwise → legacy `sendEmail` (the server SMTP identity from env). **The daily-cap check and increment only happen in the per-sender branch**; the legacy env-sender path (line 132) has *no* cap enforcement.

**Step 3 — Auto-negotiation** (lines 148-174). Gated by `getNegotiationSettings().ai_autonomy` (default **false** — see `DEFAULT_NEGOTIATION_SETTINGS`). When ON:
1. Query up to 40 `outreach_emails` with `kind = "initial"`, `ai_managed = true`, `replied_at IS NOT NULL`.
2. Skip any whose `negotiation_status` is already `agreed` or `declined` (line 159).
3. Load the whole thread (`id.eq.X OR parent_id.eq.X`).
4. **Skip if any row's `reply_kind === "auto"`** (line 164) — autoresponders aren't negotiated.
5. Compute `latestReply` = newest `replied_at` and `lastAnswer` = newest `sent_at` among sent negotiation rows. If `!latestReply` → skip. If `lastAnswer >= latestReply` → skip (their latest reply already answered) — this is what makes negotiation *not* re-fire on the same reply.
6. `negotiateThread(id)` — generates and (since autonomy is on) **sends** the AI reply immediately. Tallied into `negotiations.sent` / `.drafted`.

Any error is caught into `negotiations.errors`.

**Step 4 — Auto follow-ups** (lines 178-182). Calls `runFollowups()` (see follow-up section). This **schedules** (does not send) day-2 no-reply nudges; they go out on a later run when due. Respects the global kill-switch. Errors → `followups.errors`.

**Response** (line 184): `200 { due, sent, failed, cappedSkipped, dupSkipped, replies, negotiations, followups, results }` where `results` is a per-email `{ id, ok, error? }` array.

---

### IMAP reply detection

File: `src/lib/email/imap.ts`. A **read-only** sweep of each sender's Gmail INBOX (the same app password used for SMTP grants IMAP). It finds which outstanding sent emails got an inbound message, classifies each, and updates the DB.

#### Classification — `classify(from, subject, headers)` (lines 33-47)

Returns one of `"reply" | "bounce" | "auto"`, checked in this priority order:
1. **`bounce`** — matched first, so a delivery failure that threads back to our send is never mistaken for a real reply. Triggers on: sender matching `mailer-daemon|postmaster|mail delivery (system|subsystem)`; subject matching a large set (`delivery status notification`, `undeliverable`, `failure notice`, `address not found`, `no such user`, …); or headers matching `x-failed-recipients:`, `content-type: multipart/report`, `report-type=delivery-status`, `action: failed`, `status: 5.x.x`.
2. **`auto`** — autoresponders/OOO. Triggers on headers (`auto-submitted: auto-*`, `x-autoreply:`, `x-autorespond:`, `x-auto-response-suppress:`, `precedence: auto_reply|bulk|junk`) or subject (`out of office`, `automatic reply`, `auto-reply`, `on vacation`, `annual leave`, `maternity/parental leave`, …).
3. **`reply`** — everything else (a genuine human reply).

#### Matching — `detectReplies(user, pass, outstanding, ownAddresses)` (lines 87-158)

- **Own-address filter** (lines 96-97, 128): builds `own = { user, ...ownAddresses }` (all lowercased) and **skips any inbound message whose From is one of our own addresses.** This prevents our own threaded follow-up (subject `Re: …`, `References: <initial-id>`) or a test send that landed back in the scanned mailbox from being counted as a prospect reply. The comment (lines 91-95) notes a genuine reply is *always* from the prospect, so filtering our own can never drop a real reply.
- **How a match is found** (lines 99-137): builds `byMsgId` (our `message_id` → email id). For each inbound message it looks for any of our message-ids as a **substring of the raw headers** (`In-Reply-To`/`References`). Legacy sends with no stored `message_id` fall back to a **subject + from** match (`normSubject` strips `Re:`/`Fwd:` prefixes; From must equal the recipient we emailed).
- **Search window** (lines 103-113): IMAP `SEARCH SINCE (earliest sent_at − 24h)`, capped to the **last 500** UIDs.
- **Prefer reply over bounce/auto** (lines 140-144): if several inbound messages match one send, a genuine `reply` wins over a `bounce`/`auto`.
- **Excerpt** (`fetchExcerpt`, lines 73-83): downloads the best text part (prefers `text/plain`, else `text/html` via `findTextPart`), reads up to 40 KB, and `stripToText` cleans HTML/entities and truncates to **1500 chars**.

#### Sweep — `runReplyDetection(opts)` (lines 174-245)

Defaults: `backfillDays = 30`, `minMinutesBetween = 15`.
- `getOutstandingSentForReplyCheck(30, { includeReplied: rescanAll })` returns outstanding sent emails grouped by sending mailbox (see queries section).
- **`ownAddresses`** (lines 182-186): union of every sending mailbox + every enabled shared sender (`getEnabledSharedSenders`) + `SMTP_USER` + `SMTP_FROM_EMAIL`.
- **Per-mailbox rate limit** (`shouldCheck`, lines 161-167): a Redis `SET imap:lastcheck:<account> NX EX (min*60)` — only the **first** caller within a 15-minute window per account actually connects to Gmail. `force` bypasses it. With no Redis → always checks.
- For each mailbox: decrypt its app password (`getUserAppPasswordEnc`); legacy `""` sender uses `SMTP_PASS`. Missing password → `errors.push("<acct>: no app password")` and skip.
- For each match:
  - **`reply`** (lines 204-222): best-effort sentiment (`analyzeSentiment`, dynamically imported). Then **attribute to the thread anchor** — `anchorId = (row.kind !== "initial" && row.parent_id) ? row.parent_id : id` — so one reply lands on the *initial*, never double-stamped on both the initial and our follow-up (the "FOLLOW-UP + REPLIED" double-badge bug). `recordReplyOnAnchor(...)` is **idempotent**; only when it reports a genuinely new reply do we `repliesFound++` and immediately `stopPendingFollowupsForAuthor(authorId, "Canceled: recipient replied")` — closing the schedule→reply→send gap so a queued nudge can't land after they've engaged.
  - **`bounce`** (lines 223-233): clears any bogus `replied_at`, sets `bounced_at`, sets `followup_skipped: true`, `bounces++`, stops pending follow-ups (`"Canceled: address bounced"`), and **discards the author** (`setAuthorDiscarded(true)` → drops them from every workflow). `discarded++`.
  - **`auto`** (lines 234-237): records the classification but sets `replied_at: null`. Counted as neither reply nor bounce (`autoReplies++`).
- `markRepliesChecked(all ids)` stamps `reply_checked_at` (line 239). Per-mailbox errors are caught into `result.errors` (line 240-242).

Returns `{ accountsChecked, repliesFound, bounces, autoReplies, discarded, errors }`.

`rescanAll` (via `includeReplied`) re-examines already-replied sends so past mis-classifications (e.g. a bounce once marked as a reply) can be corrected.

---

### Auto follow-ups

File: `src/lib/email/followup.ts`. Constants: `FOLLOWUP_DAYS = 2`, kill-switch key `followups:enabled`, `FOLLOWUP_LEAD_MS = 24h` (from `queries.ts:1606`).

**Kill-switch** — `followupsEnabled()` (lines 13-18): reads Redis `followups:enabled`. **Default ON** (null/undefined → true; no Redis → true). Toggled via `PATCH /api/emails/followups` (see below).

**`runFollowups(force = false)`** (lines 68-91):
1. If `!force && !followupsEnabled()` → return `{ skippedDisabled: true }` (no work). `force` (the one-time backfill script) ignores the kill-switch but **still** respects per-email `followup_skipped` and the one-per-recipient rule.
2. `getEmailsNeedingFollowup(2, 50)` — candidates: `kind='initial'`, `status='sent'`, `replied_at IS NULL`, `success_at IS NULL`, `followup_skipped = false`, `sent_at <= now-2d`, **and no existing follow-up child** (excluded in the query, `queries.ts:1627-1642`).
3. For each: `generateFollowupBody(...)` (Claude Haiku via OpenRouter; see below), build `subject` = `Re: <original>` (unless already `Re:`), then `createFollowupRow({ kind:'followup', parent_id, status:'scheduled', scheduled_at: now + 24h, sender_email, sent_by_email })`. `generated++`, `scheduled++`.
4. Per-recipient errors caught into `errors`.

The 24h lead (`FOLLOWUP_LEAD_MS`) is a **review buffer**: the candidate is already >2 days past its initial send, so this is the window to toggle the follow-up off before it sends — not the 2-day wait itself.

**`generateFollowupBody`** (lines 29-61): if `OPENROUTER_API_KEY` is missing or `< 20` chars → returns a hard-coded `fallback`. Otherwise calls `anthropic/claude-haiku-4-5` (`max_tokens: 200`, `temperature: 0.7`, 20s timeout) with hard rules (2-3 sentences, reply-in-thread tone, `Hi <first>,` … `Best,\nAbdullah`, no placeholders, no em/en dashes). Output is `sanitize`d (em/en dashes → commas); if empty or `hasPlaceholder` (`[…]` or `{{…}}`) → fallback. Non-OK response or thrown error → fallback. **It never fails hard** — a follow-up always gets a body.

**Arming a single follow-up** — `setFollowupArmed(id, armed)` (`queries.ts:1682-1696`): disarm parks it (`status:'draft'`, `scheduled_at:null`) *and* sets the parent's `followup_skipped=true` so `runFollowups` never regenerates it; re-arm reschedules (`now+24h`) and clears the parent flag. No-op if already sent.

**Toggle endpoint** — `src/app/api/emails/followups/route.ts`:
- `GET` → `{ enabled }` (401 if not signed in).
- `PATCH { enabled }` → sets the global kill-switch (401 if not signed in).

---

### Role / generic address parking

File: `src/lib/email/roleEmail.ts`. `isRoleEmail(raw)`:
1. Strips a leading `mailto:`, lowercases, takes the local part before `@` (returns `false` if no `@` or empty local).
2. Drops a `+tag` suffix, then collapses all non-alphanumerics into `collapsed`.
3. Empty `collapsed` → `true`.
4. Exact match against the **`EXACT`** set (~110 tokens: `press`, `pr`, `media`, `info`, `hello`, `contact`, `editor`, `editorial`, `tips`, `team`, `support`, `admin`, `marketing`, `sales`, `partnerships`, `legal`, `careers`, `hr`, `billing`, `noreply`, `webmaster`, `abuse`, `security`, `git`, `api`, `newsletter`, `submissions`, `obits`, `bot`, …) → `true`.
5. Substring match against **`CONTAINS`** (distinctive compound stems that can't appear inside a human name: `pressinquir`, `brandlicens`, `mediarelation`, `newsroom`, `noreply`, `donotreply`, `mailerdaemon`, `unsubscribe`, `submiss`, `inquir`, `enquir`, `editorial`, `newsdesk`, `customercare`, …) → `true`.

Used at **send time** (`process/route.ts:77`): a due email whose recipient is a role address is parked (`status: failed`, `followup_skipped: true`) so it never sends and never generates a follow-up. The comment explains why: these get scraped off sites and attached to many authors, so we'd email one shared inbox over and over.

---

### Smart scheduling — `computeSmartSchedule`

File: `src/lib/email/schedule.ts`. Produces one `{ id, at }` slot per recipient such that: every send lands inside the recipient's **local `[startH, endH)` window**, all sends from one account are spaced `>= gap_minutes` apart **globally**, and no more than `daily_cap` land on one **UTC** calendar day.

Config normalization (lines 85-88): `startH = clampHour(send_hour_start, 9)`; `endH = max(startH+1, clampHour(send_hour_end, 17))`; `gapMs = max(1, gap_minutes||15) * 60_000`; `cap = max(1, daily_cap||50)`. `clampHour` bounds to `[0,23]`.

Algorithm (lines 91-131):
1. For each recipient compute `earliest` (`earliestFor`): if now is inside their window → now; if before → today's window start; if after → tomorrow's window start.
2. Sort recipients by `earliest`.
3. Greedy: `cand = max(r.earliest, lastSlot + gapMs)`, then normalize in a **bounded 800-iteration** loop: if `cand` is outside the window, jump to today's-or-next-day's window start; if it violates the gap, push to `lastSlot + gapMs`; if the day's count already hit `cap`, jump to the next day's window start. Break when valid.
4. Record the slot, advance `lastSlot`, bump `dayCount[utcDayKey(cand)]`.
5. Return slots sorted by time.

Wall-clock↔UTC conversions use `Intl.DateTimeFormat` in the target IANA timezone (`partsInTz`/`utcFromLocal`), so DST is handled by the platform.

**Caller** — `POST /api/workflows/[id]/send` (`src/app/api/workflows/[id]/send/route.ts`), the schedule-time entry into the whole engine. It shapes `config` from the *sending identity's* `user_email_config` (timezone/window/gap/cap), and every recipient in that queue is scheduled in that sender's own timezone (`recipients = sendable.map(e => ({ id, tz: config.timezone }))`, line 98). See "Schedule-time flow" below.

---

### Contacted / dedup model (two layers)

Two independent guards prevent double-contacting a person or a shared inbox:

**Layer 1 — schedule-time snapshot: `getContactedAuthorIds(excludeWorkflowId)`** (`queries.ts:1891-1936`).
- "Contacted" = a durable signal: `status IN (sent, scheduled)` **OR** `sent_at`/`replied_at`/`bounced_at` not null. Durable columns are checked because regenerating an email resets `status` to `ready` but leaves `sent_at` intact — status alone would wrongly "forget" an emailed person.
- Excludes the current workflow (so re-scheduling within a campaign isn't blocked).
- **Shared-inbox propagation** (lines 1905-1925): maps every contacted author → their `mailto` address(es), then pulls in *any other* author sharing one of those addresses — so the same inbox is never hit twice, and both authors show "contacted".
- **Manual overrides** (lines 1926-1934): `authors.contacted_override = true` forces contacted; `= false` forces *not* contacted ("email them again"). This wins over derived history.
- Used by `send`, `generate-emails`, `generate-linkedin`, and `GET /api/outreach/contacted`.

**Layer 2 — send-time safety net: `addressHasOtherSentInitial(recipient, excludeId)`** (`queries.ts:142-156`).
- The schedule-time guard is a point-in-time snapshot, so two workflows can each schedule the same inbox moments apart and both come due. At the moment of sending, this re-checks whether the recipient inbox has **already been sent an INITIAL** from some other row: `status='sent'`, `kind IN (initial, null)`, `recipient_override IS NULL`, matching `contacts.type='mailto'` / `value ILIKE 'mailto:<addr>'`, `id != excludeId`, `limit 1`.
- **Only initials count** — follow-ups and negotiation replies legitimately reuse an already-emailed inbox within their thread, so they're exempt (`process/route.ts:90`). **Test/redirected sends** (`recipient_override` set) are excluded on both sides, because they never actually reached the prospect's inbox.

**Related helper** — `isAuthorContacted(authorId)` (`queries.ts:1952-1984`) gives the single-author verdict for the prospect drawer, applying the same derived-history + shared-inbox + override logic.

---

### Key DB primitives (`src/lib/db/queries.ts`)

- **`getDueEmails(limit=50 from caller)`** (2436-2453): `status='scheduled'`, `scheduled_at <= now`, ordered by `scheduled_at`, limited. Resolves `recipient = recipient_override?.trim() || <author's mailto>` (override wins for admin test-sends).
- **`getOutstandingSentForReplyCheck(days=30, {includeReplied})`** (1548-1571): `status='sent'`, `bounced_at IS NULL`, `sent_at >= now-days`, `limit 2000`; skips `replied_at != null` unless `includeReplied`. Grouped by `sender_email` (`""` = legacy env-sender). Recipient derived from the author's `mailto` contact; rows with no recipient are dropped.
- **`recordReplyOnAnchor(anchorId, meta, nowIso)`** (1578-1589): reads the anchor's current `replied_at`+`reply_excerpt`; **if already replied and the excerpt is identical → returns `false` (no-op)**, so re-seeing the same message on a later sweep never bumps `replied_at` (which would wrongly re-trigger auto-negotiation). Otherwise updates `replied_at=now`, clears `bounced_at`, and returns `true`.
- **`scheduleWorkflowEmails(id, ids[], times[], senderEmail?, sentByEmail?, aiManaged?, toOverride?)`** (2176-2194): per email sets `scheduled_at`, `status='scheduled'`, `error=null`, and conditionally `sender_email`, `sent_by_email`, `ai_managed=true`, `recipient_override=<test target>`.
- **`stopPendingFollowupsForAuthor(authorId, reason)`** (1879-1886): flips this author's `kind='followup'` rows in `status IN (scheduled, pending)` to `status='draft'`, `scheduled_at=null`, `followup_skipped=true`, `error=reason`. Returns count.
- **`updateOutreachEmail(id, patch)`** (1519-1541): the shared write for all status/reply/bounce/success fields.
- **`getUserAppPasswordEnc` / `getUserEmailConfig`** (2080-2083 / 2054-2066): per-sender credential + window/cap config; config falls back to `DEFAULT_USER_CONFIG`.
- **`getEnabledSharedSenders`** (2120-2128): shared identities currently toggled on — used both for the "Send from" picker and to seed `ownAddresses` in reply detection.

---

### Delivery — `deliverOutreach` and the SMTP transports

File: `src/lib/email/deliver.ts`. `deliverOutreach({ to, subject, body, sender, sentBy, inReplyTo, references })`:
- `cc = (sentBy && sentBy !== sender) ? sentBy : undefined`.
- If `sender` set → decrypt its app password; **if none → `{ ok:false, error:"… hasn't set a Gmail app password …" }`** (no throw); else `sendEmailAs` with that identity + `from_name`.
- Else → legacy `sendEmail` (server SMTP env identity).

Used by the per-email "Send now" action *and* by `negotiateThread` (auto-negotiation). Note the batch processor (`process/route.ts`) inlines the same logic rather than calling `deliverOutreach`.

`src/lib/email/smtp.ts`:
- `sendEmail` — the shared env transport (`SMTP_HOST/USER/PASS`, port 465 implicit TLS or 587 STARTTLS). Missing env → `{ ok:false, error:"SMTP not configured …" }`.
- `sendEmailAs` — builds a throwaway `smtp.gmail.com:465` transport per send from the user's own app password (correct even if the password changed). Both convert the plain-text body to simple `<br>` HTML and thread via `inReplyTo`/`references`. Errors are caught → `{ ok:false, error }`.
- `verifyGmail` / `verifyTransport` — connection tests (Settings "test connection"), no send.

---

### Daily fan-out cron — `POST /api/cron/daily`

File: `src/app/api/cron/daily/route.ts`. `maxDuration = 300`; `GET` delegates to `POST`. Same `authorized()` convention as the engine (CRON_SECRET Bearer / `?key=` / session; open if no secret).

Because Vercel Hobby allows only 2 crons, this single daily entry fans out to every once-a-day task, forwarding `?key=<CRON_SECRET>`:
- **Guard**: if neither `APP_URL` nor `NEXTAUTH_URL` is set → `500 { error: "APP_URL/NEXTAUTH_URL not set" }`.
- `POST /api/link-audit/run` — broken-link audit (returns fast, continues via `after()` + QStash).
- `POST /api/indexing/cron` — nightly Page Health scan (indexability + Core Web Vitals; posts its own Slack digest).
- `POST /api/digest/daily` — the ops digest (below).
- `POST /api/enrich/run` with `{ only_new: true }` — daily email-finding for authors still missing an address (`only_new` avoids re-spending credits on already-searched people).
- `after(() => hit("/api/notifications/check"))` — author-watch notifications, run **post-response** so the cron returns quickly (Vercel keeps the function alive for `after()` work).

Returns `{ ok:true, audit, pageHealth, digest, finder, notifications:"triggered" }`; each sub-call is individually `.catch`'d so one failure doesn't abort the rest.
> Note: `/api/cron/daily` is **not** listed in `vercel.json` (which contains only the `emails/process` daily cron). Its daily cadence is configured as an external QStash schedule.

**Digest** (`src/app/api/digest/daily/route.ts`): `POST` sends the digest if the toggle is on. `?dry=1` returns the built digest without sending (preview); `?force=1` sends even when the toggle is off ("send test now"). Config lives in Redis (`buildDailyDigest`/`sendDailyDigest` in `src/lib/digest/daily.ts`) — default `{ enabled: true, recipient: "zain@imagine.art" }`. The digest itself aggregates per-sender scheduled/sent/replied/won counts, template usage, and top target sites over `kind='initial'` rows.

---

### CSV / JSON export

**`GET /api/export`** (`src/app/api/export/route.ts`):
- Query params: `format` (`csv` default | `json`), `minScore`, `tool`, `archetype`, `qualified_only` (`"true"`), `min_dr`.
- **No auth check** — the route reads `getProspects({ limit: 2000, … })` directly.
- Flattens each prospect into a wide row (name, role, publication, qualification columns mirroring the Prospect Tracker sheet, composite/component scores, mentions, contacts, latest article, source). `imagineart_mentioned` is derived by scanning mentions for `"imagin"`.
- `format=json` → `NextResponse.json(rows)` with a `.json` `Content-Disposition`.
- CSV → header row from `Object.keys(rows[0] ?? {})` (empty result set yields an empty/near-empty body, guarded by `?? {}`), every cell double-quoted with `"` doubled. `Content-Type: text/csv`, attachment `genai-scout-export.csv`.

**`GET /api/workflows/[id]/export`** (`src/app/api/workflows/[id]/export/route.ts`):
- Path param `id`. **No auth check.** `getWorkflow(id)` + `getWorkflowProspects(id, { limit: 5000 })` in parallel.
- Columns: Name, Publication, Website, Domain rating (`dr_proxy_score`), Email, LinkedIn, Articles (count), Article links (joined by ` | `).
- CRLF line endings + a leading **UTF-8 BOM** so Excel reads it correctly. Filename `blog-list_<slugified-workflow-name>.csv`.
- No `?? {}` empty-guard is needed (headers are a fixed array); an empty prospect list yields a header-only CSV.

---

### Flows

**Schedule-time flow (human presses "Send").**
1. User opens a workflow's Sending view and clicks Send → `POST /api/workflows/[id]/send` with optional `{ sender_email, ai_managed, to_override }`.
2. Auth: must be signed in (401 otherwise). If `sender_email` differs from the signed-in user, the caller must be an admin (`isAdminEmail`, else 403) and the target must have a connected app password (else 400) — full "act as" (their Gmail + attributed to them).
3. If the chosen identity has no app password → `{ needsAppPassword: true, … }` (not an error status).
4. Build `config` from the sender's `user_email_config`. Fetch workflow emails + included prospects.
5. `sendable` = included, `status IN (ready, scheduled)`, **not** in `getContactedAuthorIds(id)` (unless test mode), and has a real `mailto` (unless test mode). `to_override` (test mode) bypasses the contacted-elsewhere and real-email guards.
6. If none → `{ scheduled: 0, skippedContacted, reason }`.
7. `computeSmartSchedule(recipients, config, now)` → slots; `scheduleWorkflowEmails(...)` persists `scheduled_at`/`status='scheduled'`/`sender_email`/`sent_by_email`/`ai_managed`/`recipient_override`.
8. Response reports counts, first/last send time, and the effective window/gap/cap.

**Automated tick flow (every ~30 min via QStash / manual "Process now").**
1. Authorize → acquire the `lock:emails:process` lock (skip if held).
2. `runReplyDetection()` — connect to each sender's Gmail (rate-limited to once per 15 min per mailbox), classify inbound mail, stamp replies on thread anchors, mark bounces (+ discard author), record autoresponders, and stop pending follow-ups for anyone who replied or bounced.
3. `getDueEmails(50)` → for each: reject no-recipient, park role addresses, park cross-campaign duplicate initials, park nudges to already-engaged parents, then send (per-sender cap enforced via Redis counter) and stamp `sent`/`message_id` or `failed`.
4. If AI autonomy is on: for each AI-managed initial with an *unanswered new* reply, generate and send the next negotiation reply.
5. `runFollowups()` — schedule day-2 no-reply nudges (respecting the kill-switch and per-email skips) to send on a future tick.
6. Return the tallies; release the lock.

**Reply → cascade.** A genuine reply → `replied_at` on the anchor (idempotent) → pending follow-ups for that author canceled → (if AI-managed + autonomy on) a negotiation reply generated and sent on this or the next tick → follow-up generation permanently excludes replied initials.

**Bounce → cascade.** A bounce → `bounced_at` set, `replied_at` cleared, `followup_skipped=true` → pending follow-ups canceled → author `discarded=true` (removed from all workflows) → excluded from the next reply-check sweep (`bounced_at IS NULL` filter).

---

### Edge cases & cautions

- **Export routes are unauthenticated.** Both `GET /api/export` and `GET /api/workflows/[id]/export` read prospect/contact data (including emails and LinkedIn URLs) with **no session or CRON_SECRET check**. Anyone who can reach the URL can download the full prospect list. This is the single most notable gap in this area.
- **`CRON_SECRET` unset = wide open.** In `authorized()` (engine, daily cron, digest), a missing `CRON_SECRET` returns `true` for *everyone*. Fine for local dev; dangerous if ever deployed without the secret set.
- **Daily cap only applies to the per-sender path.** In `process/route.ts`, the `getDailyCount >= cap` check and `incrDailyCount` live inside `if (sender) { … }`. The legacy env-sender branch (line 132) sends with **no cap enforcement**. Also, with **no Redis**, `getDailyCount` always returns `0`, so the cap is never hit — local dev (and any Redis outage) sends the entire due queue uncapped.
- **Capped emails silently wait.** A cap hit (`cappedSkipped`) does a bare `continue` — the email keeps `status='scheduled'` and will be retried on a later run once the UTC day rolls over or the counter expires (48h TTL). It is not surfaced as an error; it just sits.
- **Cap counter key vs. UTC day.** The cap bucket is a UTC calendar day (`day = toISOString().slice(0,10)`), but sends are scheduled in the *recipient's local* window. Around UTC midnight a sender's cap can appear to "reset" mid-evening local time.
- **Lock TTL vs. function budget.** Lock TTL is 290s while `maxDuration` is 300s — a ~10s window near the end where the lock could expire before the function returns, theoretically allowing an overlapping run. Small in practice.
- **Reply idempotency hinges on the excerpt.** `recordReplyOnAnchor` treats a reply as "already recorded" only if the stored `reply_excerpt` is byte-identical. A *different* inbound message on the same thread (a second real reply, or the same reply with a changed excerpt) will bump `replied_at` and can **re-trigger auto-negotiation**. Conversely, this is intentional so a genuine new reply *does* get answered.
- **Legacy subject-match reply detection can mis-attribute.** For sends with no stored `message_id`, matching is by `from == recipient` + normalized subject. If two campaigns used the same subject to the same person, or the subject was edited, a reply could match the wrong send. New sends store a `message_id`, so this only affects old rows.
- **Bounce → author discard is aggressive.** A single classified bounce sets `discarded=true`, removing the author from **every** workflow. A false-positive bounce classification (unusual mailer-daemon wording, a forwarded DSN) would silently drop a real prospect. There is no auto-undo; a human must un-discard.
- **Own-address filter depends on a complete `ownAddresses` set.** Reply detection ignores inbound mail from our own addresses. If a sending identity or shared sender is missing from that set (e.g. an alias, or `SMTP_FROM_EMAIL` not configured), our own threaded follow-up could be counted as a prospect reply.
- **IMAP search is capped at the last 500 UIDs** since (earliest send − 24h). A mailbox with heavy inbound volume could push a real reply out of the scanned window on a busy day.
- **Role-address detector is heuristic.** `isRoleEmail` uses fixed `EXACT`/`CONTAINS` lists. A legitimate person whose local-part contains a stem like `inquir`/`enquir`/`submiss`/`editorial` (e.g. an unlucky surname) would be wrongly parked; a novel role prefix not in the lists would slip through. `CONTAINS` deliberately avoids short name-like tokens to limit false positives.
- **Auto-negotiation runs only when autonomy is ON (default OFF).** With `ai_autonomy=false`, replies are detected and follow-ups canceled, but no reply is *sent* — negotiation only produces drafts (via the manual button). Autonomy also self-limits: it skips `hard_no`/`unsubscribe` intents (`run.ts:60`), skips threads with an autoresponder in them, and won't answer a reply it already answered.
- **`negotiateThread` deletes prior unsent drafts.** Each run deletes any existing `kind='negotiation'`, `status='draft'` child before inserting the new one (`run.ts:69`) — so a human-reviewed draft that wasn't sent is overwritten on the next generate.
- **Follow-up parent guard closes most, not all, of the race.** A nudge is parked at send time if the parent has `replied_at`/`success_at`, and reply detection also cancels pending follow-ups on reply. But a reply that arrives *after* reply-detection has run and *while* the send loop is mid-flight (same tick) could still send — the window is small because reply detection runs first each tick.
- **Test-send override bypasses several guards.** `to_override` at schedule time skips the contacted-elsewhere and real-email requirements; `recipient_override` at send time skips the send-time dup guard and is excluded from `addressHasOtherSentInitial`/`getContactedAuthorIds` (so a test never marks the real prospect as contacted and never blocks a real send). Auto-negotiation on a test thread stays on the test address (`run.ts:64`).
- **Manual overrides win over history.** `contacted_override=true/false` overrides all derived contacted logic; `false` ("email them again") will let a previously-emailed person be scheduled again — by design, but easy to forget.
- **`senderInfo` cache is per-run.** An app password rotated during a 5-minute run won't be picked up until the next run.
- **Follow-up generation never blocks on the LLM.** Missing/short `OPENROUTER_API_KEY`, a non-OK response, a timeout, or placeholder output all fall back to a canned body — so a follow-up always sends *something*; it just may be generic.

---

### Consolidated CHECKS & CAUTIONS table

| Guard | Where | What it protects | How it can be bypassed / fails |
|---|---|---|---|
| `authorized()` (Bearer / `?key=` / session) | `process`, `cron/daily`, `digest` | Only cron/QStash/signed-in users trigger automation | **Unset `CRON_SECRET` → open to everyone**; export routes have no auth at all |
| Redis send-lock `lock:emails:process` (290s) | `process/route.ts:37` | No double-sending from overlapping triggers | No Redis → always "acquired" (local dev not de-duped); ~10s TTL-vs-maxDuration gap |
| No-recipient check | `process:69` | Never attempt a send with no address | — (hard fail → `status:failed`) |
| `isRoleEmail` parking | `process:77`, `roleEmail.ts` | Never pitch a shared/non-person inbox | Heuristic lists — false negatives (novel prefix) slip through; false positives park real people |
| Send-time dup guard `addressHasOtherSentInitial` | `process:90`, `queries:142` | Same inbox not sent two *initials* across campaigns | Skipped for follow-ups/negotiations (by design) and for `recipient_override` (test) |
| Schedule-time contacted snapshot `getContactedAuthorIds` | `send:75`, `queries:1891` | Don't queue someone already emailed elsewhere | Skipped in test mode (`to_override`); `contacted_override=false` forces re-contact |
| Follow-up parent-engaged park | `process:112` | Don't nag someone who already replied/converted | Only `kind='followup'`; negotiations always proceed; tiny same-tick race |
| Missing app password | `process:122`, `deliver.ts:16` | Don't try to send from an unconfigured identity | — (hard fail with clear error) |
| Per-sender daily cap | `process:128`, `redis.ts:100` | Protect a Gmail account from over-sending | **Not enforced on the legacy env-sender path**; not enforced with no Redis (`getDailyCount→0`) |
| Own-address filter | `imap.ts:96,128` | Our own follow-ups/test sends not counted as replies | Fails if an active sending alias is missing from `ownAddresses` |
| Bounce classification (checked before auto/reply) | `imap.ts:33` | A DSN never counted as a real reply | Heuristic regex — unusual bounce wording could be missed or over-matched |
| `recordReplyOnAnchor` idempotency | `queries:1578` | Same reply not re-stamped (no repeated negotiation trigger) | Different excerpt on the same thread does re-stamp (intended for genuine new replies) |
| Reply→anchor attribution | `imap.ts:213` | No "FOLLOW-UP + REPLIED" double badge | Requires correct `kind`/`parent_id` on the row |
| IMAP per-mailbox rate limit `shouldCheck` (15 min) | `imap.ts:161` | Don't hammer Gmail every tick | `force` bypasses; no Redis → checks every run |
| Auto-negotiation autonomy gate | `process:153`, `settings.ts` | AI only auto-replies when explicitly enabled | Default OFF; also skips `hard_no`/`unsubscribe`/`auto` threads and already-answered replies |
| `negotiateThread` deletes stale drafts | `run.ts:69` | No pile-up of stale AI drafts | Overwrites an un-sent human-reviewed draft on regenerate |
| Follow-up kill-switch `followups:enabled` | `followup.ts:13` | Stop all auto follow-ups instantly | Default ON; `runFollowups(force=true)` (backfill) ignores it |
| Per-email `followup_skipped` | `queries` (multiple) | Stop follow-ups to one recipient (reply/bounce/manual disarm) | — (set automatically on reply/bounce and by `setFollowupArmed(false)`) |
| One-follow-up-per-recipient | `queries:1627` | No duplicate nudges | — |
| Follow-up 24h lead (`FOLLOWUP_LEAD_MS`) | `queries:1606` | Review window to disarm before it sends | — |
| Author-discard on bounce | `imap.ts:232` | Bad address drops out of all workflows | Aggressive — a mis-classified bounce silently removes a real prospect; no auto-undo |
| Smart-schedule window/gap/cap + 800-iter bound | `schedule.ts` | Sends within local hours, spaced, capped; no infinite loop | UTC day bucket ≠ local day near midnight |
| `APP_URL`/`NEXTAUTH_URL` present | `cron/daily:25` | Fan-out has a base URL to call | Hard 500 if missing |
| Digest enabled toggle | `digest/daily`, `digest/daily.ts` | Don't email the ops digest when off | `?force=1` sends anyway; `?dry=1` previews without sending |
