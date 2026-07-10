import PQueue from "p-queue";
import { getSeeds, getHarvesters, insertDiscoveryHits, getPendingHits, getAllPendingHits, markHitProcessed,
  upsertDomain, upsertAuthor, upsertArticle, upsertContact, upsertMention, linkArticleAuthor,
  upsertScore, createPipelineRun, finishPipelineRun, isSuppressed,
  getUnprofiledHits, countUnprofiledHits, getProfiledUrlSet,
  linkAuthorsToCampaign, updateCampaign, getAuthorIdsForUrls,
  insertFlaggedContent, markArticleSafetyChecked, recomputeAuthorSafetyScore } from "@/lib/db/queries";
import { gdeltHarvester } from "@/lib/harvesters/gdelt";
import { hnHarvester } from "@/lib/harvesters/hackernews";
import { redditHarvester } from "@/lib/harvesters/reddit";
import { wordpressHarvester } from "@/lib/harvesters/wordpress";
import { braveHarvester } from "@/lib/harvesters/brave";
import { googleNewsHarvester } from "@/lib/harvesters/googlenews";
import { duckduckgoHarvester } from "@/lib/harvesters/duckduckgo";
import { scrapegraphHarvester } from "@/lib/harvesters/scrapegraph";
import { webSearchHarvester } from "@/lib/harvesters/websearch";
import { searchEnabled } from "@/lib/search/webSearch";
import { rssHarvester } from "@/lib/harvesters/rss";
import { SEED_DOMAINS } from "@config/seeds";
import { fetchPage, closeSharedBrowser } from "@/lib/extract/fetch";
import { BlitzDomainCache } from "@/lib/enrich/blitz";
import { resolveEmail, anyEnricherEnabled } from "@/lib/enrich/resolve";
import { isLikelyPersonName } from "@/lib/enrich/personFilter";
import { isBlockedUrl } from "@/lib/util/url";
import { extractMetadata } from "@/lib/extract/metadata";
import { extractReadability } from "@/lib/extract/readability";
import { detectMentions, extractOutboundLinks } from "@/lib/extract/mentions";
import { extractContacts } from "@/lib/extract/contacts";
import { classifyArchetype } from "@/lib/extract/archetype";
import { scoreArticleRelevance } from "@/lib/extract/relevance";
import { classifyContentSafety } from "@/lib/extract/safety";
import { computeScore } from "@/lib/score";
import { runLearningPhase, getPromotedLearnedDomains } from "@/lib/learn";
import { generateDiscoveryQueries } from "@/lib/pipeline/queries";
import { resolveAuthorSeed, harvestAuthorArchive } from "@/lib/pipeline/authorSeed";
import { createPipelineController, clearStop, isStopRequested } from "@/lib/pipeline/abort";
import { startBuffer, pushEvent, finishBuffer, snapshotBuffer } from "@/lib/pipeline/eventBuffer";
import { saveCheckpoint, deleteCheckpoint, type PipelineCheckpoint } from "@/lib/pipeline/checkpoint";
import { qstashPublish, isServerless } from "@/lib/qstash";
import type { SeedTool } from "@/lib/types";

export interface PipelineProgress {
  stage: string;
  message: string;
  harvester?: string;      // which harvester sent this
  query?: string;          // current query
  hitsDiscovered?: number;
  processed?: number;
  authors?: number;
  errors?: number;
  stats?: Record<string, number>;
}

type ProgressCallback = (p: PipelineProgress) => void;

export interface DiscoveryOptions {
  campaignId?: string;
  customKeywords?: string[];
  seedWriter?: { name?: string; articleUrl?: string };
  resume?: {
    usedQueries: string[];
    round: number;
    rssComplete: boolean;
    discoveryDone?: boolean;
    oldRunId?: string;
  };
}

export async function runDiscoveryPipeline(onProgress?: ProgressCallback, options?: DiscoveryOptions): Promise<{ runId: string; stats: Record<string, number> }> {
  const controller = createPipelineController();
  const signal = controller.signal;
  await clearStop(); // clear any stale durable stop flag from a prior run

  const run = await createPipelineRun("full");
  startBuffer(run.id);
  await snapshotBuffer().catch(() => {}); // overwrite any stale previous-run snapshot at once
  const stats: Record<string, number> = { hitsDiscovered: 0, processed: 0, authors: 0, errors: 0 };

  // Time budget: on Vercel, stop before the 300s function limit and hand off to a fresh
  // invocation via QStash (resume). Locally there's no limit, so run to completion.
  const deadline = isServerless() ? Date.now() + 210_000 : Infinity;
  const timeUp = () => Date.now() > deadline;

  // Bridge a durable Stop (set on any instance) to the local controller, and mirror the
  // buffer to Redis for cross-instance progress + heartbeat.
  const hb = setInterval(() => {
    void snapshotBuffer();
    void isStopRequested().then((s) => { if (s && !signal.aborted) controller.abort("user stopped"); });
  }, 2500);

  const emit = (stage: string, message: string, extra?: Partial<PipelineProgress>) => {
    const ev = { stage, message, ...stats, ...extra };
    pushEvent(ev);
    onProgress?.(ev);
  };

  const harvLog = (harvester: string, message: string, query?: string) => {
    emit("harvester", message, { harvester, query });
  };

  try {
    // ─── Stage 1: Discover ────────────────────────────────────────────────────
    emit("discover", "Loading seeds and harvester config...");
    const [seeds, harvesters] = await Promise.all([getSeeds(), getHarvesters()]);
    const enabledSeeds = seeds.filter((s) => s.enabled);
    const ourProductSeeds = seeds.filter((s) => s.category === "our_product");
    const ourProductNames = ourProductSeeds.flatMap((s) => [s.name, ...s.aliases]);

    const enabledHarvesters = harvesters.filter((h) => h.enabled);
    const harvesterMap: Record<string, boolean> = {};
    for (const h of enabledHarvesters) harvesterMap[h.name] = true;

    const activeHarvesterNames = Object.keys(harvesterMap);
    emit("discover", `${activeHarvesterNames.length} harvesters active`);

    // Log harvester status once
    const allNames = ["gdelt", "hackernews", "reddit", "rss", "wordpress", "ghost", "commoncrawl", "wayback", "brave"];
    for (const name of allNames) {
      harvLog(name, harvesterMap[name] ? "Harvester enabled and ready" : "Harvester disabled — skipping");
    }
    harvLog("googlenews", "Harvester enabled and ready (free, no key required)");
    harvLog("duckduckgo", "Harvester enabled and ready (free, no key required)");
    harvLog("websearch", searchEnabled() ? "Harvester enabled (real search API)" : "No search API key — skipping");
    harvLog("scrapegraph", process.env.SGAI_API_KEY ? "Harvester enabled (LLM search, uses credits)" : "No SGAI_API_KEY — skipping");

    const resume = options?.resume;
    const isResuming = !!resume;
    if (resume?.oldRunId) await deleteCheckpoint(resume.oldRunId);
    if (isResuming) {
      emit("discover", `Resuming from round ${resume.round} — ${resume.usedQueries.length} queries already done, skipping completed work`);
    }

    const queue = new PQueue({ concurrency: 12 });
    signal.addEventListener("abort", () => queue.clear(), { once: true });

    // ── RSS — run once upfront (fixed feeds, no query benefit from looping) ────
    if (harvesterMap.rss && !resume?.rssComplete) {
      // RSS source set = curated SEED_DOMAINS ∪ auto-learned domains (sites where past runs
      // found real writers). This is the self-expanding half — it grows every run. We do NOT
      // read harvester_config.domains anymore: it used to REPLACE the seed list and had filled
      // up with footer/CDN/social junk.
      const learnedDomains = await getPromotedLearnedDomains().catch(() => []);
      const rssDomains = [...new Set([...SEED_DOMAINS.map((d) => d.toLowerCase()), ...learnedDomains])];
      if (learnedDomains.length) harvLog("rss", `Source set: ${SEED_DOMAINS.length} curated + ${learnedDomains.length} auto-learned = ${rssDomains.length} domains`);
      // Rotate through a bounded window each run so a large domain list stays within the
      // serverless budget while every domain gets covered over successive daily runs (RSS is a
      // freshness source — recent items — so cycling the window is exactly what we want).
      const RSS_WINDOW = 70;
      const domainsToFetch = rssDomains.length <= RSS_WINDOW
        ? rssDomains
        : (() => {
            const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400_000);
            const start = (dayOfYear * RSS_WINDOW) % rssDomains.length;
            const rotated = [...rssDomains.slice(start), ...rssDomains.slice(0, start)];
            return rotated.slice(0, RSS_WINDOW);
          })();
      harvLog("rss", `Fetching feeds from ${domainsToFetch.length} of ${rssDomains.length} domains (rotating window)`);
      queue.add(async () => {
        if (signal.aborted) return;
        const rawHits = await rssHarvester.run("ai", { domains: domainsToFetch }).catch((e) => {
          harvLog("rss", `Error: ${e?.message ?? "unknown"}`); return [];
        });
        // Dedupe by URL (same article shows up in multiple feeds/sitemaps) and skip URLs
        // we've already profiled — so we only save genuinely-new, unique hits.
        const rssSeen = new Set<string>();
        const rssProfiled = await getProfiledUrlSet();
        const hits = rawHits.filter((h) => {
          if (!h.url || rssSeen.has(h.url) || rssProfiled.has(h.url)) return false;
          rssSeen.add(h.url);
          return true;
        });
        const dupes = rawHits.length - hits.length;
        harvLog("rss", `Done — ${rawHits.length} feed items, ${hits.length} new unique (${dupes} dupes/already-known skipped), saving...`);
        // Bulk insert (chunks of 500) — one-by-one would take ~270ms/hit and blow the function limit.
        for (let i = 0; i < hits.length; i += 500) {
          const saved = await insertDiscoveryHits(hits.slice(i, i + 500)).catch(() => 0);
          stats.hitsDiscovered += saved;
          harvLog("rss", `Saved ${Math.min(i + 500, hits.length)}/${hits.length} RSS hits...`);
        }
        harvLog("rss", `All ${hits.length} unique RSS hits saved`);
      });
      await queue.onIdle();
      if (signal.aborted) { emit("stopped", `Pipeline stopped by user.`); finishBuffer(); await finishPipelineRun(run.id, "completed", { ...stats, stopped: 1 }); return { runId: run.id, stats }; }
      await saveCheckpoint({ runId: run.id, round: 0, usedQueries: [], rssComplete: true, discoveryDone: false, campaignId: options?.campaignId, customKeywords: options?.customKeywords, savedAt: new Date().toISOString() });
    } else if (resume?.rssComplete) {
      harvLog("rss", "Skipping RSS — already completed before interruption");
    }

    const { supabaseAdmin } = await import("@/lib/db/supabase");

    // ── Author-seed harvest — writer/article-seeded campaigns, runs once upfront ──
    // Only on a fresh (non-resumed) run — the checkpoint doesn't track seed-harvest
    // completion, and re-running it on resume would just waste fetches/search calls
    // (inserts dedupe harmlessly on conflict, so it's wasteful, not incorrect).
    const seedWriter = options?.seedWriter;
    const hasKeywords = (options?.customKeywords?.length ?? 0) > 0;
    if (seedWriter && !isResuming) {
      const label = seedWriter.name ?? seedWriter.articleUrl ?? "writer";
      emit("discover", `Looking up writer seed: ${label}...`);
      try {
        const resolved = await resolveAuthorSeed(seedWriter);
        if (resolved) {
          emit("discover", `Found ${resolved.resolvedName} on ${resolved.domain}`);
          let archiveUrls: string[] = [];
          if (resolved.authorPageUrl) {
            const { data: existingArticles } = await supabaseAdmin.from("articles").select("url_canonical");
            const existingSet = new Set((existingArticles ?? []).map((r: any) => r.url_canonical));
            archiveUrls = await harvestAuthorArchive(resolved.authorPageUrl, existingSet);
          }
          const seedUrls = [resolved.sampleArticleUrl, ...archiveUrls];
          const saved = await insertDiscoveryHits(seedUrls.map((url) => ({ url, source: "author_seed" })));
          stats.hitsDiscovered += saved;
          emit("discover", `Author seed: ${saved} candidate articles queued for ${resolved.resolvedName}`);
        } else {
          emit("discover", `Couldn't find a page for ${label} — continuing${hasKeywords ? " with keyword search only" : ""}`);
        }
      } catch (e: any) {
        emit("discover", `Author-seed lookup failed: ${e?.message ?? "unknown error"} — continuing${hasKeywords ? " with keyword search only" : ""}`);
      }
    }

    // ── Query-based harvesters: loop until TARGET new hits found ──────────────
    const TARGET_NEW_HITS = 2500;
    const MAX_QUERY_ROUNDS = 15;
    const usedQueries: string[] = resume?.usedQueries ? [...resume.usedQueries] : [];
    let round = resume?.round ?? 0;

    const redditCfg = enabledHarvesters.find((h) => h.name === "reddit");
    const configuredSubs = (redditCfg?.config?.subreddits as string[] | undefined) ?? [];
    const wpDomains = SEED_DOMAINS.slice(0, 30);

    // Counters per harvester (persist across rounds)
    let gdeltTotal = 0, hnTotal = 0, redditTotal = 0, wpTotal = 0, braveTotal = 0;

    const MIN_NEW_PER_ROUND = 15; // stop once rounds are consistently yielding fewer than this
    let weakRounds = 0; // consecutive rounds under MIN_NEW_PER_ROUND — require 2 in a row to stop,
                         // so one unlucky round doesn't kill an otherwise-productive run
    // A pure writer-seeded campaign (no keywords) skips the keyword round loop entirely —
    // it shouldn't pull in unrelated authors via the global default topics. If keywords are
    // ALSO given alongside the seed writer, both run.
    const skipKeywordLoop = !!seedWriter && !hasKeywords;
    if (resume?.discoveryDone) {
      emit("discover", "Discovery already complete from a previous run — resuming article processing only");
    } else if (skipKeywordLoop) {
      emit("discover", "Writer-only campaign — skipping keyword search, moving to processing");
    }
    while (!resume?.discoveryDone && !skipKeywordLoop && round < MAX_QUERY_ROUNDS && !signal.aborted && !timeUp()) {
      // Count new pending hits so far
      const { count: pendingCount } = await supabaseAdmin
        .from("discovery_hits")
        .select("id", { count: "exact", head: true })
        .eq("processed", false);
      const newHits = pendingCount ?? 0;

      if (newHits >= TARGET_NEW_HITS) {
        emit("discover", `Target reached — ${newHits} new articles found after ${round} query rounds`);
        break;
      }

      round++;
      const hitsAtRoundStart = stats.hitsDiscovered;
      emit("discover", `Round ${round} — ${newHits}/${TARGET_NEW_HITS} new articles so far, generating ${30} more queries...`);

      const queries = await generateDiscoveryQueries(enabledSeeds, usedQueries, options?.customKeywords);
      const freshQueries = queries.filter((q) => !usedQueries.includes(q.toLowerCase()));
      usedQueries.push(...freshQueries.map((q) => q.toLowerCase()));

      if (freshQueries.length === 0) {
        emit("discover", `No new queries generated — stopping discovery at round ${round}`);
        break;
      }

      emit("discover", `Round ${round}: ${freshQueries.length} fresh queries — ${freshQueries.slice(0, 3).join(" · ")}…`);

      // ── GDELT (free API) ───────────────────────────────────────────────────────
      if (harvesterMap.gdelt) {
        for (const q of freshQueries.slice(0, 20)) {
          queue.add(async () => {
            if (signal.aborted) return;
            harvLog("gdelt", `"${q}"`, q);
            const hits = await gdeltHarvester.run(q, { signal }).catch(() => []);
            gdeltTotal += hits.length;
            stats.hitsDiscovered += await insertDiscoveryHits(hits).catch(() => 0);
            if (hits.length) harvLog("gdelt", `"${q}" → ${hits.length} (total: ${gdeltTotal})`, q);
          });
        }
      }

      // ── HACKER NEWS ──────────────────────────────────────────────────────────
      if (harvesterMap.hackernews) {
        for (const q of freshQueries.slice(0, 8)) {
          queue.add(async () => {
            if (signal.aborted) return;
            const hits = await hnHarvester.run(q, { signal }).catch(() => []);
            hnTotal += hits.length;
            stats.hitsDiscovered += await insertDiscoveryHits(hits).catch(() => 0);
            if (hits.length) harvLog("hackernews", `"${q}" → ${hits.length} (total: ${hnTotal})`, q);
          });
        }
      }

      // ── REDDIT ───────────────────────────────────────────────────────────────
      if (harvesterMap.reddit) {
        for (const q of freshQueries.slice(0, 6)) {
          queue.add(async () => {
            if (signal.aborted) return;
            harvLog("reddit", `Tree: "${q}"`, q);
            const hits = await redditHarvester.run(q, { subreddits: configuredSubs, depth: 3, signal }).catch(() => []);
            redditTotal += hits.length;
            stats.hitsDiscovered += await insertDiscoveryHits(hits).catch(() => 0);
            if (hits.length) harvLog("reddit", `"${q}" → ${hits.length} links (total: ${redditTotal})`, q);
          });
        }
      }

      // ── WORDPRESS ────────────────────────────────────────────────────────────
      if (harvesterMap.wordpress) {
        for (const q of freshQueries.slice(0, 5)) {
          queue.add(async () => {
            if (signal.aborted) return;
            const hits = await wordpressHarvester.run(q, { domains: wpDomains, signal }).catch(() => []);
            wpTotal += hits.length;
            stats.hitsDiscovered += await insertDiscoveryHits(hits).catch(() => 0);
            if (hits.length) harvLog("wordpress", `"${q}" → ${hits.length} posts (total: ${wpTotal})`, q);
          });
        }
      }

      // ── BRAVE ────────────────────────────────────────────────────────────────
      if (harvesterMap.brave && process.env.BRAVE_SEARCH_API_KEY) {
        for (const q of freshQueries.slice(0, 5)) {
          queue.add(async () => {
            if (signal.aborted) return;
            const hits = await braveHarvester.run(q, { signal }).catch(() => []);
            braveTotal += hits.length;
            stats.hitsDiscovered += await insertDiscoveryHits(hits).catch(() => 0);
            if (hits.length) harvLog("brave", `"${q}" → ${hits.length} (total: ${braveTotal})`, q);
          });
        }
      } else if (round === 1 && harvesterMap.brave) {
        harvLog("brave", "No BRAVE_SEARCH_API_KEY — skipping");
      }

      // ── GOOGLE NEWS (free) ─────────────────────────────────────────────────────
      for (const q of freshQueries.slice(0, 20)) {
        queue.add(async () => {
          if (signal.aborted) return;
          const hits = await googleNewsHarvester.run(q, { signal }).catch(() => []);
          stats.hitsDiscovered += await insertDiscoveryHits(hits).catch(() => 0);
          if (hits.length) harvLog("googlenews", `"${q}" → ${hits.length}`, q);
        });
      }

      // ── DUCKDUCKGO (free web search) ─────────────────────────────────────────────
      for (const q of freshQueries.slice(0, 20)) {
        queue.add(async () => {
          if (signal.aborted) return;
          const hits = await duckduckgoHarvester.run(q, { signal }).catch(() => []);
          stats.hitsDiscovered += await insertDiscoveryHits(hits).catch(() => 0);
          if (hits.length) harvLog("duckduckgo", `"${q}" → ${hits.length}`, q);
        });
      }

      // ── WEB SEARCH (Tavily/Google/Brave/Serper — real API, not scraped) ──────────
      if (searchEnabled()) {
        for (const q of freshQueries.slice(0, 5)) {
          queue.add(async () => {
            if (signal.aborted) return;
            const hits = await webSearchHarvester.run(q, { maxResults: 10, signal }).catch(() => []);
            stats.hitsDiscovered += await insertDiscoveryHits(hits).catch(() => 0);
            if (hits.length) harvLog("websearch", `"${q}" → ${hits.length}`, q);
          });
        }
      } else if (round === 1) {
        harvLog("websearch", "No search API key (TAVILY/GOOGLE_CSE/BRAVE/SERPER) — skipping");
      }

      // ── SCRAPEGRAPH (LLM web search) — costs credits, so few queries, only if keyed ──
      if (process.env.SGAI_API_KEY) {
        for (const q of freshQueries.slice(0, 3)) {
          queue.add(async () => {
            if (signal.aborted) return;
            const hits = await scrapegraphHarvester.run(q, { maxResults: 5, signal }).catch(() => []);
            stats.hitsDiscovered += await insertDiscoveryHits(hits).catch(() => 0);
            if (hits.length) harvLog("scrapegraph", `"${q}" → ${hits.length}`, q);
          });
        }
      } else if (round === 1) {
        harvLog("scrapegraph", "No SGAI_API_KEY — skipping");
      }

      if (round === 1) {
        if (harvesterMap.ghost) harvLog("ghost", "Implementation pending — skipping");
        if (harvesterMap.commoncrawl) harvLog("commoncrawl", "Implementation pending — skipping");
        if (harvesterMap.wayback) harvLog("wayback", "Implementation pending — skipping");
      }

      await queue.onIdle();

      const roundNewHits = stats.hitsDiscovered - hitsAtRoundStart;

      // Save checkpoint after every round so we can resume if interrupted
      await saveCheckpoint({ runId: run.id, round, usedQueries: [...usedQueries], rssComplete: true, discoveryDone: false, campaignId: options?.campaignId, customKeywords: options?.customKeywords, savedAt: new Date().toISOString() });

      if (round > 1 && roundNewHits < MIN_NEW_PER_ROUND) {
        weakRounds++;
        if (weakRounds >= 2) {
          emit("discover", `Round ${round} yielded only ${roundNewHits} new articles — 2 rounds in a row with diminishing returns, stopping discovery early`);
          break;
        }
        emit("discover", `Round ${round} yielded only ${roundNewHits} new articles — giving it one more round before stopping`);
      } else {
        weakRounds = 0;
      }

      if (signal.aborted) {
        emit("stopped", `Pipeline stopped by user. ${stats.hitsDiscovered} hits collected.`);
        finishBuffer();
        await finishPipelineRun(run.id, "completed", { ...stats, stopped: 1 });
        return { runId: run.id, stats };
      }
    }

    // Final count
    const { count: finalCount } = await supabaseAdmin
      .from("discovery_hits")
      .select("id", { count: "exact", head: true })
      .eq("processed", false);

    emit("discover", `Discovery complete — ${finalCount ?? stats.hitsDiscovered} new articles found across ${round} query rounds (${usedQueries.length} queries total)`);

    // ─── Stage 2: Process hits ────────────────────────────────────────────────
    emit("process", "Loading pending articles from database...");
    const CONCURRENCY = 8;   // keep memory bounded — each worker holds full HTML
    const BATCH_SIZE = 100;  // add 100 closures at a time, wait for idle, then next 100
    const processQueue = new PQueue({ concurrency: CONCURRENCY });
    const MAX_TOTAL = 5000;

    const rawHits = await getAllPendingHits(MAX_TOTAL);
    // Skip URLs we've ALREADY profiled into an article — no re-fetch, no re-scoring, no
    // wasted LLM tokens on a re-run. Also dedupe by URL (same article from multiple sources).
    const alreadyProfiled = await getProfiledUrlSet();
    const seenUrls = new Set<string>();
    let profiledSkipped = 0;
    const allHits = rawHits.filter(h => {
      if (isBlockedUrl(h.url)) return false;            // video/social platform — not an article
      if (seenUrls.has(h.url)) return false;
      seenUrls.add(h.url);
      if (alreadyProfiled.has(h.url)) { profiledSkipped++; return false; }
      return true;
    });
    const hitTotal = allHits.length;
    emit("process", `${hitTotal} new articles queued — skipped ${profiledSkipped} already profiled + ${rawHits.length - hitTotal - profiledSkipped} dupes — ${CONCURRENCY} workers`);

    signal.addEventListener("abort", () => processQueue.clear(), { once: true });

    let finishedCount = 0;
    const discoveredAuthorIds = new Set<string>();

    const processOnce = (hit: (typeof allHits)[0]) => processQueue.add(async () => {
      if (signal.aborted) return;
      let host = "";
      try { host = new URL(hit.url).hostname; } catch {}
      try {
        const authorId = await processHit(hit.id, hit.url, hit.source, enabledSeeds, ourProductNames, signal);
        stats.processed++;
        if (authorId) { discoveredAuthorIds.add(authorId); stats.authors++; }
      } catch (e: any) {
        if (!signal.aborted) stats.errors++;
      } finally {
        await markHitProcessed(hit.id).catch(() => {});
        finishedCount++;
        if (finishedCount % 25 === 0 || finishedCount === hitTotal) {
          emit("process", `${finishedCount}/${hitTotal} profiled — last: ${host} (${stats.processed} kept, ${stats.errors} err)`);
        }
      }
    });

    // Add hits in BATCH_SIZE chunks — wait for each batch to drain before queuing more.
    // This keeps at most BATCH_SIZE closures (+ their HTML) live in memory at once,
    // instead of all 5000 at once.
    for (let i = 0; i < allHits.length; i += BATCH_SIZE) {
      if (signal.aborted || timeUp()) break;
      const batch = allHits.slice(i, i + BATCH_SIZE);
      for (const hit of batch) processOnce(hit);
      await processQueue.onIdle();
    }

    // Vercel time budget hit with work still to profile → hand off to a fresh invocation via
    // QStash (resume). Skip campaign-linking/learning this chunk; the final chunk does them.
    if (isServerless() && timeUp() && !signal.aborted) {
      const { count: stillPending } = await supabaseAdmin
        .from("discovery_hits").select("id", { count: "exact", head: true }).eq("processed", false);
      if ((stillPending ?? 0) > 0) {
        // Discovery (the round loop above) has already fully finished by this point — it's
        // only Stage 2 profiling that ran out of time. Mark discoveryDone so a resume skips
        // straight to processing instead of re-entering the round loop (which would otherwise
        // misread this unprofiled backlog as "not enough articles found yet" and start a whole
        // new round of harvester queries — the exact bug that looked like an unrequested restart).
        await saveCheckpoint({ runId: run.id, round, usedQueries: [...usedQueries], rssComplete: true, discoveryDone: true, campaignId: options?.campaignId, customKeywords: options?.customKeywords, savedAt: new Date().toISOString() });
        const handed = await qstashPublish("/api/discover", { resume: true, auto: true });
        emit(handed ? "process" : "complete", handed
          ? `Time budget reached — ${stillPending} articles remaining, continuing in a new run…`
          : `Time budget reached — ${stillPending} remaining. Click Resume to continue.`);
        finishBuffer();
        await finishPipelineRun(run.id, "completed", { ...stats, continued: handed ? 1 : 0 });
        return { runId: run.id, stats };
      }
    }

    // stats.authors is a per-hit tally (inflated: one author writes many articles).
    // Report DISTINCT authors instead so it matches the Prospects/campaign counts.
    stats.authors = discoveredAuthorIds.size;
    emit("process", `Processing complete — ${stats.processed} articles, ${discoveredAuthorIds.size} distinct authors, ${stats.errors} errors`);

    // ─── Campaign linking ─────────────────────────────────────────────────────
    // Link EVERY author tied to a processed article — not just ones processHit freshly
    // created this run. Re-discovered articles that already existed return no authorId
    // from processHit, so we resolve authors from the DB by the processed URLs.
    if (options?.campaignId) {
      const urlAuthorIds = await getAuthorIdsForUrls(allHits.map((h) => h.url)).catch(() => []);
      const allAuthorIds = new Set<string>([...discoveredAuthorIds, ...urlAuthorIds]);
      stats.authors = allAuthorIds.size; // match exactly what gets linked to the campaign
      if (allAuthorIds.size > 0) {
        emit("learn", `Linking ${allAuthorIds.size} authors to campaign...`);
        await linkAuthorsToCampaign(options.campaignId, [...allAuthorIds]);
      }
      await updateCampaign(options.campaignId, { status: "done" });
    }

    // ─── Stage 2.5: Email enrichment ──────────────────────────────────────────
    // Disabled during discovery — enrichment now runs on demand from the Email Finder
    // page (campaign-scoped, with progress) so it doesn't burn API credits automatically.
    // Re-enable by setting ENRICH_ON_DISCOVERY=true.
    if (process.env.ENRICH_ON_DISCOVERY === "true" && anyEnricherEnabled() && discoveredAuthorIds.size > 0 && !signal.aborted) {
      try {
        const ids = [...discoveredAuthorIds].slice(0, 500);
        const { data: authorRows } = await supabaseAdmin
          .from("authors")
          .select("id, full_name, contacts(type), domain:domains!primary_domain_id(host)")
          .in("id", ids);
        const needing = (authorRows ?? [])
          .filter((a: any) => !(a.contacts ?? []).some((c: any) => c.type === "mailto"))
          .map((a: any) => ({ id: a.id, name: a.full_name, domain: a.domain?.host ?? "" }))
          .filter((a: any) => a.domain)
          .slice(0, 60); // keep within function limits; backfill script handles the rest
        if (needing.length > 0) {
          emit("learn", `Finding emails for ${needing.length} authors...`);
          const cache = new BlitzDomainCache();
          let count = 0;
          for (const a of needing) {
            if (signal.aborted) break;
            const r = await resolveEmail(a.name, a.domain, { blitzCache: cache }).catch(() => null);
            if (r) {
              count++;
              await upsertContact({ author_id: a.id, type: "mailto", value: `mailto:${r.email}`, confidence: r.score ? r.score / 100 : 0.85, source: r.source, verified_syntax: true }).catch(() => {});
            }
          }
          emit("learn", `Email enrichment complete — ${count} emails found.`);
        }
      } catch (e: any) {
        emit("learn", `Email enrichment skipped: ${e?.message ?? "error"}`);
      }
    }

    // ─── Stage 3: Self-learning ───────────────────────────────────────────────
    emit("learn", "Running learning phase — discovering new sources from this run...");
    try {
      const learned = await runLearningPhase();
      stats.learnedSubreddits = learned.subredditsFound;
      stats.learnedDomains = learned.domainsFound;
      stats.promoted = learned.promoted;
      emit("learn", `Learning complete — ${learned.subredditsFound} new subreddits, ${learned.domainsFound} new domains. ${learned.promoted} auto-promoted.`);
    } catch (e: any) {
      emit("learn", `Learning phase error: ${e?.message ?? "unknown"}`);
    }

    emit("complete", `All done! ${stats.processed} articles processed, ${stats.authors} author profiles built, ${stats.hitsDiscovered} total hits.`);
    await deleteCheckpoint(run.id); // clean up — no need to resume a successful run
    finishBuffer();
    await finishPipelineRun(run.id, "completed", stats);
  } catch (e: any) {
    finishBuffer();
    await finishPipelineRun(run.id, "failed", stats, e?.message);
    throw e;
  } finally {
    clearInterval(hb);
    await snapshotBuffer().catch(() => {});
    // Always shut down the headless browser so it doesn't linger between runs
    await closeSharedBrowser();
  }

  return { runId: run.id, stats };
}

// Arabic, Persian/Urdu, Hebrew, CJK, Japanese, Korean, Cyrillic, Devanagari, Thai
const NON_ENGLISH_RE = /[؀-ۿ֐-׿一-鿿぀-ヿ가-힯Ѐ-ӿऀ-ॿ฀-๿]/;
// URL path segments that indicate a non-English locale
const NON_ENGLISH_PATH_RE = /\/(?:ar|zh|zh-cn|zh-tw|ja|ko|ru|fr|de|es|pt|it|nl|pl|tr|vi|th|hi|ur|fa|he)\//i;

function isLikelyEnglish(url: string, title?: string): boolean {
  if (NON_ENGLISH_PATH_RE.test(url)) return false;
  if (title && NON_ENGLISH_RE.test(title)) return false;
  return true;
}

export async function processHit(hitId: string, url: string, source: string, seeds: SeedTool[], ourProductNames: string[] = [], abortSignal?: AbortSignal): Promise<string | undefined> {
  let host = "";
  try { host = new URL(url).hostname; } catch { return; }
  if (isBlockedUrl(url)) { await markHitProcessed(hitId).catch(() => {}); return; } // video/social — not an article
  if (await isSuppressed(host)) return;

  // Skip URLs already in the articles table — prevents re-fetching on new discovery runs
  // that re-discover the same pages via different queries or sources.
  // BUT still return the existing article's author so campaign linking captures it
  // (otherwise re-discovered/reprocessed articles never get linked to the campaign).
  const { supabaseAdmin } = await import("@/lib/db/supabase");
  const { data: existingArticle } = await supabaseAdmin
    .from("articles")
    .select("id")
    .eq("url_canonical", url)
    .maybeSingle();
  if (existingArticle?.id) {
    const { data: aa } = await supabaseAdmin
      .from("article_authors")
      .select("author_id")
      .eq("article_id", existingArticle.id)
      .limit(1)
      .maybeSingle();
    return aa?.author_id ?? undefined;
  }

  const fetched = await fetchPage(url, abortSignal);
  if (!fetched) return;

  if (abortSignal?.aborted) return;

  const { html, finalUrl } = fetched;
  const meta = extractMetadata(html, finalUrl);
  if (!isLikelyEnglish(finalUrl || url, meta.title ?? undefined)) return;
  const readable = await extractReadability(html, finalUrl);
  const text = readable?.textContent ?? "";

  const domainRow = await upsertDomain(host, {
    name: meta.publisher,
    last_seen: new Date().toISOString(),
  });

  const { relevant, score: llmRelevanceScore } = await scoreArticleRelevance(meta.title ?? "", text.slice(0, 600), abortSignal);
  if (!relevant || abortSignal?.aborted) return;

  const archetype = classifyArchetype(meta.title ?? "", text);

  const articleRow = await upsertArticle({
    url_canonical: finalUrl || url,
    title: meta.title,
    excerpt: meta.description ?? readable?.excerpt,
    published_at: meta.publishedAt,
    lead_image_url: meta.image,
    domain_id: domainRow.id,
    archetype,
    readability_text_excerpt: text.slice(0, 1000),
    source,
  });

  const mentionsRaw = detectMentions(text + " " + (meta.title ?? ""), seeds);
  for (const m of mentionsRaw) {
    await upsertMention(articleRow.id, m.tool, m.count).catch(() => {});
  }

  const outLinks = extractOutboundLinks(html, finalUrl);
  if (outLinks.length > 0) {
    const { supabaseAdmin } = await import("@/lib/db/supabase");
    await supabaseAdmin.from("links").upsert(
      outLinks.slice(0, 50).map((l) => ({ article_id: articleRow.id, target_url: l.url, anchor_text: l.anchor })),
      { onConflict: "article_id,target_url", ignoreDuplicates: true }
    );
  }

  const authorName = meta.author ?? readable?.byline;
  // Only create an author if the byline is actually a person's name — skip publication
  // names, "Staff", section labels, and bio blurbs that get mis-extracted as authors.
  if (authorName && isLikelyPersonName(authorName, meta.publisher ?? host)) {
    const authorRow = await upsertAuthor({
      full_name: authorName,
      avatar_url: undefined,
      primary_domain_id: domainRow.id,
      source,
      same_as_json: meta.authorUrl ? [meta.authorUrl] : [],
    });

    await linkArticleAuthor(articleRow.id, authorRow.id);

    // Discovery does NOT save emails. Page-scraping an article grabs every address on it
    // (help@, press@, and other people quoted in the piece) — mostly junk that isn't the
    // author's. The Email Finder resolves the author's real email properly (person-targeted,
    // junk-filtered). We DO keep social/contact-form/author-page links — they feed the Finder.
    const contacts = extractContacts(html, text, finalUrl).filter((c) => c.type !== "mailto");
    for (const c of contacts.slice(0, 10)) {
      await upsertContact({
        author_id: authorRow.id,
        type: c.type,
        value: c.value,
        confidence: c.confidence,
        source,
        verified_syntax: true,
      }).catch(() => {});
    }

    if (meta.authorUrl) {
      await upsertContact({
        author_id: authorRow.id,
        type: "author_page",
        value: meta.authorUrl,
        confidence: 0.9,
        source,
        verified_syntax: true,
      }).catch(() => {});
    }

    const { supabaseAdmin } = await import("@/lib/db/supabase");
    const [
      { data: authorContacts },
      { data: authorMentions },
      { count: domainArticleCount },
    ] = await Promise.all([
      supabaseAdmin.from("contacts").select("*").eq("author_id", authorRow.id),
      supabaseAdmin.from("mentions").select("*").eq("article_id", articleRow.id),
      supabaseAdmin.from("articles").select("id", { count: "exact", head: true }).eq("domain_id", domainRow.id),
    ]);

    const scoreData = computeScore({
      author: authorRow,
      articles: [articleRow],
      contacts: authorContacts ?? [],
      allMentions: authorMentions ?? [],
      ourProductNames: ourProductNames.length > 0 ? ourProductNames : undefined,
      domainArticleCount: domainArticleCount ?? 1,
      llmRelevanceScore,
    });

    await upsertScore({ author_id: authorRow.id, article_id: articleRow.id, ...scoreData }).catch(() => {});

    // Content safety screening — flags NSFW/hate-violence-illegal/political-controversy
    // content so we can avoid pitching writers whose work doesn't fit. Fails open (never
    // blocks the pipeline) and runs on every new article, per-author score recomputed
    // only when something is actually flagged.
    try {
      const safety = await classifyContentSafety(meta.title ?? "", text, abortSignal);
      if (safety.category && safety.severity) {
        await insertFlaggedContent({ author_id: authorRow.id, article_id: articleRow.id, category: safety.category, severity: safety.severity, reason: safety.reason });
        await recomputeAuthorSafetyScore(authorRow.id);
      }
      await markArticleSafetyChecked(articleRow.id);
    } catch { /* screening is best-effort — never fail discovery over it */ }

    return authorRow.id;
  }
}

// ── Reprocess pipeline — skips discovery, re-runs extraction on saved hits ──
export interface ReprocessOptions {
  source?: string;
  resetAll?: boolean;
  campaignId?: string;
}

export async function runReprocessPipeline(
  opts: ReprocessOptions = {},
  onProgress?: ProgressCallback
): Promise<{ runId: string; stats: Record<string, number> }> {
  const controller = createPipelineController();
  const signal = controller.signal;

  const run = await createPipelineRun("reprocess");
  const stats: Record<string, number> = { hitsDiscovered: 0, processed: 0, authors: 0, errors: 0 };

  const emit = (stage: string, message: string, extra?: Partial<PipelineProgress>) => {
    onProgress?.({ stage, message, ...stats, ...extra });
  };

  try {
    // Only handle hits never touched before — skip anything already attempted or profiled,
    // so finished work is never redone.
    const counts = await countUnprofiledHits();
    emit("reprocess", `${counts.total} saved hits — ${counts.handled} already handled (skipping), ${counts.unprofiled} new to process`);

    // Load seeds for scoring
    const seeds = await getSeeds();
    const ourProductSeeds = seeds.filter((s) => s.category === "our_product");
    const ourProductNames = ourProductSeeds.flatMap((s) => [s.name, ...s.aliases]);
    const enabledSeeds = seeds.filter((s) => s.enabled);

    emit("process", "Loading unprofiled hits from database…");

    const MAX_TOTAL = 5000;
    const R_CONCURRENCY = 8;
    const R_BATCH = 100;
    const processQueue = new PQueue({ concurrency: R_CONCURRENCY });
    let allHits = await getUnprofiledHits(MAX_TOTAL);
    allHits = allHits.filter((h) => !isBlockedUrl(h.url)); // drop video/social platforms
    if (opts.source) allHits = allHits.filter((h) => h.source === opts.source);
    stats.hitsDiscovered = allHits.length;
    const hitTotal = allHits.length;
    if (hitTotal === 0) {
      emit("complete", "Nothing to reprocess — every saved hit is already profiled.");
      await finishPipelineRun(run.id, "completed", stats);
      return { runId: run.id, stats };
    }
    emit("process", `${hitTotal} unprofiled hits queued — ${R_CONCURRENCY} workers, ${R_BATCH}-article batches`);

    signal.addEventListener("abort", () => processQueue.clear(), { once: true });

    let finishedCount = 0;
    const discoveredAuthorIds = new Set<string>();

    const reprocessOnce = (hit: (typeof allHits)[0]) => processQueue.add(async () => {
      if (signal.aborted) return;
      let host = "";
      try { host = new URL(hit.url).hostname; } catch {}
      try {
        const authorId = await processHit(hit.id, hit.url, hit.source, enabledSeeds, ourProductNames, signal);
        stats.processed++;
        if (authorId) { discoveredAuthorIds.add(authorId); stats.authors++; }
      } catch (e: any) {
        if (!signal.aborted) stats.errors++;
      } finally {
        await markHitProcessed(hit.id).catch(() => {});
        finishedCount++;
        if (finishedCount % 25 === 0 || finishedCount === hitTotal) {
          emit("process", `${finishedCount}/${hitTotal} profiled — last: ${host} (${stats.processed} kept, ${stats.errors} err)`);
        }
      }
    });

    for (let i = 0; i < allHits.length; i += R_BATCH) {
      if (signal.aborted) break;
      const batch = allHits.slice(i, i + R_BATCH);
      for (const hit of batch) reprocessOnce(hit);
      await processQueue.onIdle();
    }

    stats.authors = discoveredAuthorIds.size; // distinct authors, not per-hit tally
    emit("process", `Reprocessing complete — ${stats.processed} articles, ${discoveredAuthorIds.size} distinct authors, ${stats.errors} errors`);

    // Link reprocessed authors to campaign if specified.
    // processHit skips already-existing articles (returns no authorId), so resolve
    // the full author set from the DB by the processed URLs instead.
    if (opts.campaignId) {
      const urlAuthorIds = await getAuthorIdsForUrls(allHits.map((h) => h.url)).catch(() => []);
      const allAuthorIds = new Set<string>([...discoveredAuthorIds, ...urlAuthorIds]);
      stats.authors = allAuthorIds.size; // match exactly what gets linked to the campaign
      if (allAuthorIds.size > 0) {
        emit("learn", `Linking ${allAuthorIds.size} authors to campaign...`);
        await linkAuthorsToCampaign(opts.campaignId, [...allAuthorIds]);
      }
      await updateCampaign(opts.campaignId, { status: "done" }).catch(() => {});
    }

    // Learning phase
    emit("learn", "Updating learned sources from reprocessed data…");
    try {
      const learned = await runLearningPhase();
      stats.promoted = learned.promoted;
      emit("learn", `Learning complete — ${learned.promoted} sources promoted`);
    } catch {}

    emit("complete", `Reprocess done. ${stats.processed} articles re-extracted, ${stats.authors} authors updated.`);
    await finishPipelineRun(run.id, "completed", stats);
  } catch (e: any) {
    await finishPipelineRun(run.id, "failed", stats, e?.message);
    throw e;
  } finally {
    await closeSharedBrowser();
  }

  return { runId: run.id, stats };
}
