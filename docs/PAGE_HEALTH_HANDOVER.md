# Page Health Check — Handover

**Feature name in the UI:** "Page Health Check" (nav label: **Page Health**, route `/indexing`)
**Built for:** the internal indexing + Core Web Vitals PRD (technical SEO defense for imagine.art)
**Status:** feature-complete for what's buildable without external credentials. **Not yet committed** — everything below is uncommitted working-tree changes in this repo.

---

## 1. What this does (plain English)

It's a self-serve health check for the SEO team, aimed at non-technical users:

1. **Crawl** — visits imagine.art pages twice: once as a plain HTTP fetch (no JavaScript — what
   Google's first pass and AI crawlers like GPTBot see), and once through headless Chromium
   (what a real browser sees). Diffing the two reveals pages whose content only appears **after**
   JavaScript runs — invisible to non-rendering crawlers.
2. **Check** — runs each page through an indexability rule set (missing title/description/H1,
   missing/duplicate canonical, noindex, robots block, thin/duplicate content, JS-gating) and
   predicts the Google Search Console coverage state it would likely get.
3. **Diagnose speed** — pulls Core Web Vitals field data (LCP/INP/CLS) per page-template from
   Google's PageSpeed Insights API, and parses the same response for *why* each metric fails
   (slow server response, long JS tasks, unsized images, etc.).
4. **Explain + route** — turns every problem into a plain-English card: what's wrong, why it
   matters, what to do, and which team should do it. Mechanical fixes route to a **GitHub PR**;
   judgment calls (rendering rewrites, thin content, slow pages) route to a **Linear ticket**.
5. **Act, on a click** — nothing happens automatically. A person clicks "Draft the fix" /
   "Create a ticket" / "Share to Slack" to actually create something. Every one of those live
   actions is logged.
6. **Remember** — every scan (manual or nightly) is saved, so there's a history list and a
   trend chart (issues found / pages hidden from search, over time).
7. **Run itself nightly** — hooked into the site's existing daily cron. Posts a Slack digest
   automatically, louder if a top page is seriously broken.

Nothing this feature does ever changes the live site. It drafts things for a human to approve.

---

## 2. What's built

| Area | Status | Notes |
|---|---|---|
| Crawl + raw-vs-rendered diff | ✅ Done | Needs `PLAYWRIGHT_ENABLED=true` + Chromium installed |
| Indexability checks + plain-English explanations | ✅ Done | |
| Predicted Google coverage state | ✅ Done | Prediction only, not live data — see §4 |
| Core Web Vitals (field data + why-it-fails diagnosis) | ✅ Done | Needs `PAGESPEED_API_KEY` to return real numbers |
| Issue → owner/priority/fix classification | ✅ Done | |
| CWV failures also routed to tickets | ✅ Done | |
| GitHub PR creation (draft-fix button) | ✅ Done | Currently points at a **placeholder repo** — see §4 |
| Linear ticket creation | ✅ Done | Creates a dedicated `SEO — Indexing & CWV (automated)` project so it never touches other Linear projects |
| Slack digest (manual button) | ✅ Done | Reuses the Link Audit feature's existing Slack webhook |
| Scan history + trend chart | ✅ Done | Stored in Supabase, new tables only |
| Nightly automatic scan + Slack post | ✅ Done | Piggybacks on the existing daily cron, no new schedule needed |
| Live Google Search Console data | 🟡 Code done, **off by default** | Needs a service account — see §4 |
| Non-technical UI rewrite | ✅ Done | Plain language throughout, tooltips on every technical term |

---

## 3. What's left / needs a decision

These are the only remaining items from the original plan. None are code bugs — they're either
credential/access decisions or intentionally-deferred scope.

1. **Point GitHub PR creation at the real repo.** Right now `TARGET_REPO` in `.env.local` points
   at a proof-of-concept scratch repo (`Vyro-ai/imagine-motion-design-web`) used to verify the
   branch → commit → PR flow works. It does **not** contain the actual imagine.art page
   templates. Before this is useful for real:
   - Point `TARGET_REPO` at whichever repo actually renders the imagine.art pages.
   - **Decide how PR content is generated.** Today `src/lib/indexing/repo.ts` writes a
     **proposal markdown file** describing the fix (see `openProposalPr`) — it does not edit
     real template files, because there's no mapping yet from "this URL/template" to "this
     source file." Building that mapping (so the PR contains a real code diff, e.g. adding a
     JSON-LD block to the right component) is the natural next engineering task here.
   - The `GITHUB_BOT_TOKEN` currently in `.env.local` is the developer's own personal `gh` CLI
     token (broad `repo` scope). Swap for a scoped GitHub App or fine-grained PAT before this
     goes into regular use.

2. **Turn on live Google Search Console data.** Fully wired in `src/lib/indexing/gsc.ts` and
   `run.ts` — it just needs a service account. No code changes required. Full walkthrough in
   [`docs/GSC_SETUP.md`](GSC_SETUP.md) (create a GCP service account → add it as a
   restricted user on the imagine.art Search Console property → set `GSC_PROPERTY` +
   `GSC_SA_JSON` in the environment). Without it the tool works fine in prediction-only mode.

3. **Get a PageSpeed API key.** Without `PAGESPEED_API_KEY`, PSI v5 returns zero quota, so the
   Speed tab shows "no field data" for every page. A free key from Google Cloud Console fixes
   this immediately — no code change.

4. **A live Strapi publish-time gate.** Explicitly **not built** — this means reaching into the
   CMS itself to block a bad page before it goes live, which needs actual code added inside
   Strapi (a lifecycle hook or publish-time API check) by whoever owns that codebase. The check
   logic this would call already exists (`src/lib/indexing/gate.ts`), so the missing piece is
   just the Strapi-side hook + a small endpoint here for it to call.

5. **Not built (smaller, deferred scope):** a CI/Lighthouse pre-deploy speed check, Ahrefs
   competitor-data enrichment, and warehousing GSC data past its 16-month retention window into
   BigQuery. None of these block the feature from being useful today.

6. **Not committed.** Everything below is sitting as uncommitted changes in this working copy —
   review the diff and commit/PR it.

---

## 4. Environment variables

Add to `.env.local` (dev) and the deployment's env vars (production). None of these are needed
for the feature to *run* except the first — everything else degrades gracefully when absent.

| Variable | Required? | Purpose |
|---|---|---|
| `PLAYWRIGHT_ENABLED=true` | **Yes**, for render-diff | Without it, render mode is always "unknown" |
| `PAGESPEED_API_KEY` | Recommended | Enables real Core Web Vitals data |
| `GITHUB_BOT_TOKEN` | For PR creation | GitHub token with `repo` scope on the target repo |
| `TARGET_REPO` | For PR creation | `owner/name` — currently a scratch/proof-of-concept repo, see §3.1 |
| `TARGET_REPO_BASE_BRANCH` | For PR creation | Defaults to `main` if unset; currently `master` |
| `LINEAR_API_KEY` | For ticket creation | Personal or workspace API key |
| `LINEAR_TEAM_KEY` | For ticket creation | e.g. `IMA` — or set `LINEAR_TEAM_ID` directly |
| `LINEAR_PROJECT_ID` | Optional | Overrides auto-created isolated project |
| `GSC_PROPERTY` / `GSC_SA_JSON` | Optional | See §3.2 / `docs/GSC_SETUP.md` |
| `CRON_SECRET` | Already existed | Shared by all cron/automated routes in this app |

(No secret values are written here — check `.env.local` directly, it's git-ignored.)

---

## 5. New/changed files

**New library code** (`src/lib/indexing/`):
`fetchRendered.ts` (raw + headless-Chromium fetch), `onpage.ts` (title/meta/canonical/schema
extraction), `renderMode.ts` (SSR vs JS-gated classification), `template.ts` (URL → page-type +
money-page detection), `gate.ts` (indexability rule set), `classify.ts` (issue → owner/priority/
fix + predicted GSC state), `routing.ts` (groups issues into PR/ticket previews, incl. CWV
tickets), `cwv.ts` (PageSpeed field data + failure diagnosis), `discover.ts` (sitemap +
robots.txt reading), `run.ts` (the orchestrator — ties all of the above together per scan),
`slackPreview.ts` (digest text), `types.ts` (shared report shape), `repo.ts` (GitHub PR client),
`linear.ts` (Linear ticket client), `persist.ts` (save/read scan history), `gsc.ts` (optional
live Search Console client).

**New API routes** (`src/app/api/indexing/`): `run` (do one scan), `pr` / `ticket` / `slack`
(the three live-action buttons), `history` + `history/[id]` (past scans), `cron` (the nightly
automated scan + Slack post).

**New page:** `src/app/indexing/page.tsx` (the whole UI).

**New migration:** `scripts/032_indexing_reports.mjs` — additive only, creates `indexing_runs`
and `indexing_dispatches` tables. **Already run against the production database** (confirmed:
these two tables exist; nothing else was touched).

**New docs:** `docs/GSC_SETUP.md` (Search Console setup walkthrough), this file.

**Changed files:**
- `src/components/layout/Sidebar.tsx` — added the "Page Health" nav entry.
- `src/app/api/cron/daily/route.ts` — added one line to fire the nightly indexing scan.
- `package.json` — added three dependencies: `@octokit/rest` (GitHub), `pg` (was already used by
  every migration script but was missing from `package.json` — pre-existing gap, now fixed),
  `google-auth-library` (GSC).

---

## 6. How to verify it

1. `npm install` (picks up the three new dependencies) and `npx playwright install chromium` if
   not already installed.
2. `npx tsc --noEmit` should be clean.
3. `npm run dev`, sign in, open **Page Health** in the sidebar, click **Check my pages**.
4. Check the **What to fix**, **All pages**, **Speed**, **Page types**, and **Share** tabs render
   with real data from a real crawl.
5. To test the live-action buttons without spamming anything real: the GitHub target is a
   scratch repo (safe to open test PRs there), and Linear tickets file into an isolated
   `SEO — Indexing & CWV (automated)` project (safe to archive/delete).
6. To test the nightly cron path without posting to Slack: `POST /api/indexing/cron?dry=1` — runs
   and saves a scan but skips the Slack post.

---

## 7. Anything risky to know about

- **No source-of-truth "which repo/file renders this page" mapping exists yet.** The PR button
  works, but only produces a proposal document, not a real code change — see §3.1.
- **The `GITHUB_BOT_TOKEN` in `.env.local` is a developer's personal token**, not a dedicated
  service credential. Rotate/replace before this is used outside of testing.
- The feature makes **zero writes** to anything except: its own two new database tables, and
  (only on an explicit button click) a GitHub PR / Linear ticket / Slack message.
