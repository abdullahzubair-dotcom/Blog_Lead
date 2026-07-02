import { supabaseAdmin } from "@/lib/db/supabase";

// Domains to never auto-promote (social, CDN, search, etc.)
const IGNORE_DOMAINS = new Set([
  "reddit.com", "twitter.com", "x.com", "facebook.com", "instagram.com",
  "youtube.com", "github.com", "google.com", "bing.com", "linkedin.com",
  "medium.com", "substack.com", "amazon.com", "wikipedia.org", "t.co",
  "bit.ly", "tinyurl.com", "goo.gl", "ow.ly", "wp.com",
  "cloudflare.com", "cdn.com", "akamai.net", "fastly.net",
  "mailto:", "javascript:", "localhost",
]);

function extractDomain(url: string): string | null {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (IGNORE_DOMAINS.has(h) || h.length < 4) return null;
    return h;
  } catch {
    return null;
  }
}

function parseSubredditFromSnippet(snippet: string | null): { sub: string; pts: number } | null {
  if (!snippet) return null;
  const m = snippet.match(/^r\/(\w+)\s*•\s*(\d+)/);
  if (!m) return null;
  return { sub: m[1], pts: parseInt(m[2], 10) };
}

export async function runLearningPhase() {
  const results = { subredditsFound: 0, domainsFound: 0, promoted: 0 };

  // ── 1. Subreddit learning ────────────────────────────────────────────────────
  // Pull all reddit hits — snippets look like "r/MachineLearning • 42 pts"
  const { data: redditHits } = await supabaseAdmin
    .from("discovery_hits")
    .select("snippet, url")
    .eq("source", "reddit")
    .not("snippet", "is", null);

  const subScores = new Map<string, number>();
  const subCounts = new Map<string, number>();

  for (const hit of redditHits ?? []) {
    const parsed = parseSubredditFromSnippet(hit.snippet);
    if (!parsed) continue;
    subScores.set(parsed.sub, (subScores.get(parsed.sub) ?? 0) + parsed.pts);
    subCounts.set(parsed.sub, (subCounts.get(parsed.sub) ?? 0) + 1);
  }

  for (const [sub, score] of subScores) {
    // Upsert — increment times_seen each time we see it across runs
    const { data: existing } = await supabaseAdmin
      .from("learned_sources")
      .select("id, times_seen, score")
      .eq("type", "subreddit")
      .eq("value", sub)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin.from("learned_sources").update({
        score: Math.max(existing.score, score),
        times_seen: existing.times_seen + 1,
        last_seen_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await supabaseAdmin.from("learned_sources").insert({
        type: "subreddit",
        value: sub,
        score,
        times_seen: 1,
      });
      results.subredditsFound++;
    }
  }

  // ── 2. Domain learning from outbound links ───────────────────────────────────
  // Find domains that appear as outbound link targets multiple times
  const { data: linkRows } = await supabaseAdmin
    .from("links")
    .select("target_url");

  const domainCounts = new Map<string, number>();
  for (const row of linkRows ?? []) {
    const d = extractDomain(row.target_url);
    if (d) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  }

  for (const [domain, count] of domainCounts) {
    if (count < 2) continue; // must appear in 2+ articles to be interesting

    const { data: existing } = await supabaseAdmin
      .from("learned_sources")
      .select("id, times_seen, score")
      .eq("type", "domain")
      .eq("value", domain)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin.from("learned_sources").update({
        score: existing.score + count,
        times_seen: existing.times_seen + 1,
        last_seen_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await supabaseAdmin.from("learned_sources").insert({
        type: "domain",
        value: domain,
        score: count,
        times_seen: 1,
      });
      results.domainsFound++;
    }
  }

  // ── 3. Auto-promote: all new subreddits immediately ──────────────────────────
  const { data: subredditsToPromote } = await supabaseAdmin
    .from("learned_sources")
    .select("*")
    .eq("type", "subreddit")
    .eq("promoted", false)
    .eq("rejected", false);

  if (subredditsToPromote?.length) {
    // Get current reddit harvester config
    const { data: redditHarvester } = await supabaseAdmin
      .from("harvester_config")
      .select("id, config")
      .eq("name", "reddit")
      .maybeSingle();

    if (redditHarvester) {
      const existing = (redditHarvester.config?.subreddits as string[] | undefined) ?? [];
      const toAdd = subredditsToPromote
        .map((r) => r.value as string)
        .filter((s) => !existing.includes(s));

      if (toAdd.length > 0) {
        await supabaseAdmin.from("harvester_config").update({
          config: { ...redditHarvester.config, subreddits: [...existing, ...toAdd] },
        }).eq("id", redditHarvester.id);

        await supabaseAdmin.from("learned_sources")
          .update({ promoted: true })
          .in("value", toAdd)
          .eq("type", "subreddit");

        results.promoted += toAdd.length;
      }
    }
  }

  // ── 4. Auto-promote: domains seen 2+ times (linked from multiple articles) ────
  const { data: domainsToPromote } = await supabaseAdmin
    .from("learned_sources")
    .select("*")
    .eq("type", "domain")
    .eq("promoted", false)
    .eq("rejected", false)
    .gte("times_seen", 2);

  if (domainsToPromote?.length) {
    // Get current RSS harvester config to add domains there
    const { data: rssHarvester } = await supabaseAdmin
      .from("harvester_config")
      .select("id, config")
      .eq("name", "rss")
      .maybeSingle();

    if (rssHarvester) {
      const existing = (rssHarvester.config?.domains as string[] | undefined) ?? [];
      const toAdd = domainsToPromote
        .map((r) => r.value as string)
        .filter((d) => !existing.includes(d));

      if (toAdd.length > 0) {
        await supabaseAdmin.from("harvester_config").update({
          config: { ...rssHarvester.config, domains: [...existing, ...toAdd] },
        }).eq("id", rssHarvester.id);

        await supabaseAdmin.from("learned_sources")
          .update({ promoted: true })
          .in("value", toAdd)
          .eq("type", "domain");

        results.promoted += toAdd.length;
      }
    }
  }

  return results;
}

export async function getLearnedSources() {
  const { data } = await supabaseAdmin
    .from("learned_sources")
    .select("*")
    .order("score", { ascending: false });
  return data ?? [];
}

export async function promoteLearnedSource(id: string) {
  const { data: source } = await supabaseAdmin
    .from("learned_sources")
    .select("*")
    .eq("id", id)
    .single();

  if (!source) return;

  if (source.type === "subreddit") {
    const { data: rh } = await supabaseAdmin
      .from("harvester_config")
      .select("id, config")
      .eq("name", "reddit")
      .maybeSingle();

    if (rh) {
      const subs = (rh.config?.subreddits as string[] | undefined) ?? [];
      if (!subs.includes(source.value)) {
        await supabaseAdmin.from("harvester_config").update({
          config: { ...rh.config, subreddits: [...subs, source.value] },
        }).eq("id", rh.id);
      }
    }
  }

  if (source.type === "domain") {
    const { data: rh } = await supabaseAdmin
      .from("harvester_config")
      .select("id, config")
      .eq("name", "rss")
      .maybeSingle();

    if (rh) {
      const domains = (rh.config?.domains as string[] | undefined) ?? [];
      if (!domains.includes(source.value)) {
        await supabaseAdmin.from("harvester_config").update({
          config: { ...rh.config, domains: [...domains, source.value] },
        }).eq("id", rh.id);
      }
    }
  }

  await supabaseAdmin.from("learned_sources").update({ promoted: true, rejected: false }).eq("id", id);
}

export async function rejectLearnedSource(id: string) {
  await supabaseAdmin.from("learned_sources").update({ rejected: true, promoted: false }).eq("id", id);
}
