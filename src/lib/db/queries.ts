import { supabaseAdmin } from "./supabase";

// Supabase REST API hard-caps at 1000 rows per request regardless of .limit().
// This helper paginates through any simple select query to get all rows.
async function fetchAllRows<T>(
  table: string,
  select: string,
  apply?: (q: any) => any
): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  let from = 0;
  while (true) {
    let q = supabaseAdmin.from(table).select(select).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await (q as any);
    if (error || !data?.length) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

import type {
  Author,
  Article,
  Contact,
  Domain,
  Score,
  Mention,
  SeedTool,
  HarvesterConfig,
  Suppression,
  PipelineRun,
  DiscoveryHit,
  ProspectCard,
  DashboardStats,
  Campaign,
  Workflow,
  WorkflowFilters,
  WorkflowProspect,
  EmailTemplate,
  LinkedinMessage,
  OutreachEmail,
  EmailSendConfig,
} from "@/lib/types";
import { isLikelyPersonName, isGuessSource } from "@/lib/enrich/personFilter";
import { registrableDomain } from "@/lib/util/domain";
import { isBlockedUrl } from "@/lib/util/url";

// ─── Domains ─────────────────────────────────────────────────────────────────

export async function upsertDomain(host: string, data: Partial<Domain> = {}): Promise<Domain> {
  const { data: domain, error } = await supabaseAdmin
    .from("domains")
    .upsert({ host, last_seen: new Date().toISOString(), ...data }, { onConflict: "host" })
    .select()
    .single();
  if (error) throw error;
  return domain;
}

export async function getDomains(): Promise<Domain[]> {
  const { data, error } = await supabaseAdmin
    .from("domains")
    .select("*")
    .order("dr_proxy_score", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── Authors ─────────────────────────────────────────────────────────────────

export async function upsertAuthor(data: Partial<Author> & { full_name: string; primary_domain_id?: string }): Promise<Author> {
  const { data: author, error } = await supabaseAdmin
    .from("authors")
    .upsert(
      { ...data, updated_at: new Date().toISOString() },
      { onConflict: "full_name,primary_domain_id", ignoreDuplicates: false }
    )
    .select()
    .single();
  if (error) throw error;
  return author;
}

export async function getAuthors(opts?: { limit?: number; offset?: number }): Promise<Author[]> {
  const { data, error } = await supabaseAdmin
    .from("authors")
    .select("*, domain:domains(*)")
    .order("created_at", { ascending: false })
    .range(opts?.offset ?? 0, (opts?.offset ?? 0) + (opts?.limit ?? 50) - 1);
  if (error) throw error;
  return data ?? [];
}

// ─── Articles ────────────────────────────────────────────────────────────────

export async function upsertArticle(data: Partial<Article> & { url_canonical: string }): Promise<Article> {
  const { data: article, error } = await supabaseAdmin
    .from("articles")
    .upsert({ ...data, updated_at: new Date().toISOString() }, { onConflict: "url_canonical" })
    .select()
    .single();
  if (error) throw error;
  return article;
}

export async function linkArticleAuthor(articleId: string, authorId: string) {
  await supabaseAdmin
    .from("article_authors")
    .upsert({ article_id: articleId, author_id: authorId }, { onConflict: "article_id,author_id", ignoreDuplicates: true });
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export async function upsertContact(data: Partial<Contact> & { type: string; value: string }): Promise<Contact> {
  const { data: contact, error } = await supabaseAdmin
    .from("contacts")
    .upsert(data, { onConflict: "author_id,type,value", ignoreDuplicates: true })
    .select()
    .single();
  if (error) throw error;
  return contact;
}

// ─── Mentions ────────────────────────────────────────────────────────────────

export async function upsertMention(articleId: string, toolName: string, count = 1) {
  await supabaseAdmin
    .from("mentions")
    .upsert({ article_id: articleId, tool_name: toolName, count }, { onConflict: "article_id,tool_name" });
}

// ─── Discovery Hits ───────────────────────────────────────────────────────────

export async function insertDiscoveryHit(hit: { url: string; source: string; query?: string; title?: string; snippet?: string }) {
  // Drop video/social/audio platforms (YouTube, TikTok, Reddit, X…) — we only profile
  // written articles & blog posts, so junk URLs never even enter the queue.
  if (isBlockedUrl(hit.url)) return;
  // Explicitly whitelist columns — never spread unknown fields (e.g. camelCase from harvesters)
  const { error } = await supabaseAdmin.from("discovery_hits").upsert(
    {
      url: hit.url,
      source: hit.source,
      query: hit.query ?? null,
      title: hit.title ?? null,
      snippet: hit.snippet ?? null,
      discovered_at: new Date().toISOString(),
      processed: false,
    },
    { onConflict: "url,source", ignoreDuplicates: true }
  );
  if (error) console.error("[insertDiscoveryHit]", error.message, hit.url.slice(0, 60));
}

// Bulk insert discovery hits — chunked upserts instead of one round-trip per hit. Sequential
// single-row inserts run ~270ms each (Vercel↔Supabase latency), so 4000 hits would blow past
// the 300s function limit mid-save; bulk does the same in seconds. Returns rows attempted.
export async function insertDiscoveryHits(
  hits: Array<{ url: string; source: string; query?: string; title?: string; snippet?: string }>,
): Promise<number> {
  const now = new Date().toISOString();
  const rows = hits
    .filter((h) => h.url && !isBlockedUrl(h.url))
    .map((h) => ({ url: h.url, source: h.source, query: h.query ?? null, title: h.title ?? null, snippet: h.snippet ?? null, discovered_at: now, processed: false }));
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabaseAdmin.from("discovery_hits").upsert(chunk, { onConflict: "url,source", ignoreDuplicates: true });
    if (error) { console.error("[insertDiscoveryHits]", error.message); continue; }
    n += chunk.length;
  }
  return n;
}

export async function getPendingHits(limit = 50): Promise<DiscoveryHit[]> {
  const { data, error } = await supabaseAdmin
    .from("discovery_hits")
    .select("*")
    .eq("processed", false)
    .order("discovered_at", { ascending: true })
    .limit(Math.min(limit, 1000)); // Supabase REST caps at 1000/request
  if (error) throw error;
  return data ?? [];
}

// Paginated version for large fetches — loops in 1000-row pages until maxTotal reached
export async function getAllPendingHits(maxTotal = 5000): Promise<DiscoveryHit[]> {
  const PAGE = 1000;
  const results: DiscoveryHit[] = [];
  let from = 0;

  while (results.length < maxTotal) {
    const to = from + PAGE - 1;
    const { data, error } = await supabaseAdmin
      .from("discovery_hits")
      .select("*")
      .eq("processed", false)
      .order("discovered_at", { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < PAGE) break; // last page
    from += PAGE;
  }

  return results.slice(0, maxTotal);
}

export async function markHitProcessed(id: string) {
  await supabaseAdmin.from("discovery_hits").update({ processed: true }).eq("id", id);
}

// URLs that already became an article (i.e. author/profiling is done).
export async function getProfiledUrlSet(): Promise<Set<string>> {
  const rows = await fetchAllRows<{ url_canonical: string }>("articles", "url_canonical");
  return new Set(rows.map((r) => r.url_canonical).filter(Boolean));
}

// Hits that have never been handled — NOT yet processed AND NOT already an article.
// Reprocess only touches these; anything already attempted (processed) or profiled is
// left alone so we never redo finished work.
export async function getUnprofiledHits(maxTotal = 5000): Promise<DiscoveryHit[]> {
  const profiled = await getProfiledUrlSet();
  const all = await fetchAllRows<DiscoveryHit>("discovery_hits", "*", (q) =>
    q.eq("processed", false).order("discovered_at", { ascending: true }));
  return all.filter((h) => !profiled.has(h.url)).slice(0, maxTotal);
}

export async function countUnprofiledHits(): Promise<{ total: number; handled: number; unprofiled: number }> {
  const profiled = await getProfiledUrlSet();
  const all = await fetchAllRows<{ url: string; processed: boolean }>("discovery_hits", "url, processed");
  const unprofiled = all.filter((h) => !h.processed && !profiled.has(h.url)).length;
  return { total: all.length, handled: all.length - unprofiled, unprofiled };
}

export async function countSavedHits(): Promise<{ total: number; pending: number }> {
  const [tot, pen] = await Promise.all([
    supabaseAdmin.from("discovery_hits").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("discovery_hits").select("id", { count: "exact", head: true }).eq("processed", false),
  ]);
  return { total: tot.count ?? 0, pending: pen.count ?? 0 };
}

export async function resetAllHitsForReprocess(source?: string) {
  // Supabase rejects bulk updates without a WHERE clause — must have at least one filter.
  // Use neq("id","") as a universal "match everything" filter when no source specified.
  let q = supabaseAdmin.from("discovery_hits").update({ processed: false });
  if (source) {
    q = q.eq("source", source);
  } else {
    q = (q as any).not("id", "is", null);
  }
  const { error } = await (q as any);
  if (error) console.error("[resetAllHitsForReprocess]", error.message);
}

export async function getAllHitsForReprocess(limit = 100, offset = 0): Promise<DiscoveryHit[]> {
  const { data } = await supabaseAdmin
    .from("discovery_hits")
    .select("*")
    .eq("processed", false)
    .order("discovered_at", { ascending: true })
    .range(offset, offset + limit - 1);
  return data ?? [];
}

// ─── Scores ──────────────────────────────────────────────────────────────────

export async function upsertScore(data: Partial<Score> & { author_id?: string; article_id?: string }): Promise<Score> {
  const { data: score, error } = await supabaseAdmin
    .from("scores")
    .upsert({ ...data, computed_at: new Date().toISOString() }, { onConflict: "author_id,article_id" })
    .select()
    .single();
  if (error) throw error;
  return score;
}

// ─── Content safety screening ──────────────────────────────────────────────────

export async function insertFlaggedContent(data: {
  author_id: string; article_id: string; category: string; severity: string; reason?: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("flagged_content")
    .upsert(data, { onConflict: "article_id" });
  if (error) throw error;
}

export async function markArticleSafetyChecked(articleId: string): Promise<void> {
  await supabaseAdmin.from("articles").update({ safety_checked_at: new Date().toISOString() }).eq("id", articleId);
}

// Recomputes and stores an author's aggregate safety_score from all their flagged articles.
export async function recomputeAuthorSafetyScore(authorId: string): Promise<number> {
  const { computeSafetyScore, buildSafetySummary } = await import("@/lib/extract/safety");
  const { data: flags } = await supabaseAdmin
    .from("flagged_content")
    .select("category, severity, reason")
    .eq("author_id", authorId);
  const score = computeSafetyScore((flags ?? []) as any);
  const summary = buildSafetySummary(score, (flags ?? []) as any);
  await supabaseAdmin.from("authors").update({ safety_score: score, safety_summary: summary, safety_checked_at: new Date().toISOString() }).eq("id", authorId);
  return score;
}

// ─── Seeds ────────────────────────────────────────────────────────────────────

export async function getSeeds(): Promise<SeedTool[]> {
  const { data, error } = await supabaseAdmin.from("seed_tools").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function upsertSeed(
  name: string,
  aliases: string[] = [],
  enabled = true,
  category: "our_product" | "competitor" | "topic" = "competitor"
) {
  await supabaseAdmin
    .from("seed_tools")
    .upsert({ name, aliases, enabled, category }, { onConflict: "name" });
}

export async function deleteSeed(id: string) {
  await supabaseAdmin.from("seed_tools").delete().eq("id", id);
}

// ─── Harvesters ──────────────────────────────────────────────────────────────

export async function getHarvesters(): Promise<HarvesterConfig[]> {
  const { data, error } = await supabaseAdmin.from("harvester_config").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function updateHarvester(id: string, data: Partial<HarvesterConfig>) {
  await supabaseAdmin.from("harvester_config").update(data).eq("id", id);
}

// ─── Suppression ─────────────────────────────────────────────────────────────

export async function getSuppressions(): Promise<Suppression[]> {
  const { data, error } = await supabaseAdmin.from("suppression").select("*").order("added_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addSuppression(type: Suppression["type"], value: string, reason?: string) {
  await supabaseAdmin
    .from("suppression")
    .upsert({ type, value, reason }, { onConflict: "value", ignoreDuplicates: true });
}

export async function deleteSuppression(id: string) {
  await supabaseAdmin.from("suppression").delete().eq("id", id);
}

export async function isSuppressed(host: string, authorName?: string): Promise<boolean> {
  const checks = [host];
  if (authorName) checks.push(authorName);
  const { data } = await supabaseAdmin
    .from("suppression")
    .select("id")
    .in("value", checks)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// ─── Pipeline Runs ────────────────────────────────────────────────────────────

export async function createPipelineRun(stage?: string): Promise<PipelineRun> {
  const { data, error } = await supabaseAdmin
    .from("pipeline_runs")
    .insert({ stage, status: "running", started_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function finishPipelineRun(id: string, status: "completed" | "failed", stats = {}, error?: string) {
  await supabaseAdmin
    .from("pipeline_runs")
    .update({ status, stats, error, finished_at: new Date().toISOString() })
    .eq("id", id);
}

export async function getPipelineRuns(limit = 20): Promise<PipelineRun[]> {
  const { data, err } = await supabaseAdmin
    .from("pipeline_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit) as any;
  return data ?? [];
}

// ─── Prospect Cards ───────────────────────────────────────────────────────────

export async function getProspects(opts: {
  limit?: number;
  offset?: number;
  minScore?: number;
  archetype?: string;
  tool?: string;
  hasContact?: boolean;
  emailStatus?: "any" | "has" | "verified" | "guessed" | "none";
  search?: string;
  sortBy?: "composite" | "freshness" | "authority" | "relevance";
  campaignId?: string;
  excludeDiscarded?: boolean;
}): Promise<{ prospects: ProspectCard[]; total: number }> {
  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;

  // ─── Collect author ID sets from each active filter ───────────────────────
  // Each filter produces a Set<string> of matching author IDs.
  // We intersect all sets at the end so every filter is AND-combined.
  const filterSets: Set<string>[] = [];

  // Always exclude non-person "authors" (publication names, "Staff", labels, bio blurbs
  // that discovery mis-extracted). Keeps the prospect list to real people.
  {
    const rows = await fetchAllRows<{ id: string; full_name: string; discarded: boolean | null }>("authors", "id, full_name, discarded");
    filterSets.push(new Set(
      rows.filter((r) => isLikelyPersonName(r.full_name) && !(opts.excludeDiscarded && r.discarded)).map((r) => r.id)
    ));
  }

  // Campaign filter: only authors discovered for this campaign
  if (opts.campaignId) {
    const rows = await fetchAllRows<{ author_id: string }>(
      "campaign_authors",
      "author_id",
      (q) => q.eq("campaign_id", opts.campaignId)
    );
    if (!rows.length) return { prospects: [], total: 0 };
    filterSets.push(new Set(rows.map((r) => r.author_id)));
  }

  // Search filter
  if (opts.search) {
    const rows = await fetchAllRows<{ id: string }>("authors", "id", (q) =>
      q.or(`full_name.ilike.%${opts.search}%,bio.ilike.%${opts.search}%`)
    );
    filterSets.push(new Set(rows.map((r) => r.id)));
  }

  // Tool filter: authors who have an article that mentions this tool
  if (opts.tool && opts.tool !== "all") {
    const ments = await fetchAllRows<{ article_id: string }>("mentions", "article_id", (q) =>
      q.ilike("tool_name", `%${opts.tool}%`)
    );
    if (!ments.length) return { prospects: [], total: 0 };
    const articleIds = [...new Set(ments.map((m) => m.article_id))];
    // Chunk .in() calls to avoid URL length limits
    const aaRows: { author_id: string }[] = [];
    for (let i = 0; i < articleIds.length; i += 500) {
      const chunk = articleIds.slice(i, i + 500);
      const rows = await fetchAllRows<{ author_id: string }>("article_authors", "author_id", (q) =>
        q.in("article_id", chunk)
      );
      aaRows.push(...rows);
    }
    filterSets.push(new Set(aaRows.map((r) => r.author_id)));
  }

  // MinScore filter: authors with composite >= threshold
  if (opts.minScore && opts.minScore > 0) {
    const rows = await fetchAllRows<{ author_id: string }>("scores", "author_id", (q) =>
      q.gte("composite", opts.minScore)
    );
    filterSets.push(new Set(rows.map((r) => r.author_id)));
  }

  // Archetype filter: authors who wrote an article of this archetype
  if (opts.archetype && opts.archetype !== "all") {
    const arts = await fetchAllRows<{ id: string }>("articles", "id", (q) =>
      q.eq("archetype", opts.archetype)
    );
    if (!arts.length) return { prospects: [], total: 0 };
    const aaRows: { author_id: string }[] = [];
    for (let i = 0; i < arts.length; i += 500) {
      const chunk = arts.slice(i, i + 500).map((a) => a.id);
      const rows = await fetchAllRows<{ author_id: string }>("article_authors", "author_id", (q) =>
        q.in("article_id", chunk)
      );
      aaRows.push(...rows);
    }
    filterSets.push(new Set(aaRows.map((r) => r.author_id)));
  }

  // HasContact filter
  if (opts.hasContact) {
    const rows = await fetchAllRows<{ author_id: string }>("contacts", "author_id", (q) =>
      q.not("author_id", "is", null)
    );
    filterSets.push(new Set(rows.map((r) => r.author_id)));
  }

  // Email-status filter: has / verified (sourced) / guessed (pattern) / none
  if (opts.emailStatus && opts.emailStatus !== "any") {
    const mailto = await fetchAllRows<{ author_id: string; source: string | null }>("contacts", "author_id, source", (q) => q.eq("type", "mailto"));
    const hasEmail = new Set(mailto.map((r) => r.author_id));
    if (opts.emailStatus === "has") filterSets.push(hasEmail);
    else if (opts.emailStatus === "guessed") filterSets.push(new Set(mailto.filter((r) => isGuessSource(r.source)).map((r) => r.author_id)));
    else if (opts.emailStatus === "verified") filterSets.push(new Set(mailto.filter((r) => !isGuessSource(r.source)).map((r) => r.author_id)));
    else if (opts.emailStatus === "none") {
      const allAuthors = await fetchAllRows<{ id: string }>("authors", "id");
      filterSets.push(new Set(allAuthors.map((r) => r.id).filter((id) => !hasEmail.has(id))));
    }
    else if (opts.emailStatus === "linkedin_no_email") {
      const li = await fetchAllRows<{ author_id: string }>("contacts", "author_id", (q) => q.eq("type", "linkedin"));
      filterSets.push(new Set(li.map((r) => r.author_id).filter((id) => !hasEmail.has(id))));
    }
  }

  // ─── Get score-sorted author order ────────────────────────────────────────
  const sortCol =
    opts.sortBy === "freshness" ? "freshness"
    : opts.sortBy === "authority" ? "authority"
    : opts.sortBy === "relevance" ? "relevance"
    : "composite";

  const scoreRows = await fetchAllRows<{ author_id: string }>("scores", "author_id", (q) =>
    q.order(sortCol, { ascending: false })
  );
  // Deduplicate while preserving order — each author can have multiple score rows (one per article)
  const seen = new Set<string>();
  const scoreSortedIds: string[] = [];
  for (const r of scoreRows) {
    if (!seen.has(r.author_id)) {
      seen.add(r.author_id);
      scoreSortedIds.push(r.author_id);
    }
  }

  // ─── Intersect all filter sets ────────────────────────────────────────────
  let validIdSet: Set<string> | null = null;
  if (filterSets.length > 0) {
    // Start from smallest for efficiency
    const sorted = [...filterSets].sort((a, b) => a.size - b.size);
    validIdSet = new Set(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      for (const id of validIdSet) {
        if (!sorted[i].has(id)) validIdSet.delete(id);
      }
    }
    if (validIdSet.size === 0) return { prospects: [], total: 0 };
  }

  // ─── Build final ordered page of IDs ─────────────────────────────────────
  let pageAuthorIds: string[];
  let total: number;

  if (scoreSortedIds.length > 0) {
    // Authors with scores, in sort order, filtered to valid set
    const ordered = scoreSortedIds.filter(id => validIdSet === null || validIdSet.has(id));
    // Append any authors that have no score row at the end
    if (validIdSet !== null) {
      const withScore = new Set(scoreSortedIds);
      for (const id of validIdSet) {
        if (!withScore.has(id)) ordered.push(id);
      }
    }
    total = ordered.length;
    pageAuthorIds = ordered.slice(offset, offset + limit);
  } else {
    // No scores yet — fall back to valid set or all authors
    const allValid = validIdSet ? [...validIdSet] : [];
    total = allValid.length;
    pageAuthorIds = allValid.slice(offset, offset + limit);
  }

  if (pageAuthorIds.length === 0) return { prospects: [], total };

  // ─── Fetch full author data for this page ─────────────────────────────────
  const { data, error } = await supabaseAdmin
    .from("authors")
    .select(
      // Every prospect has ≥1 article (discovery authors always do; manual adds require an
      // article link). The !inner join enforces "prospects are article authors".
      `*,
      domain:domains(*),
      article_authors!inner(
        article:articles(
          *,
          mentions(*),
          domain:domains(*)
        )
      ),
      contacts(*),
      scores(*)`
    )
    .in("id", pageAuthorIds);

  if (error) {
    console.error("getProspects error:", error);
    return { prospects: [], total: 0 };
  }

  // Re-sort results to match the requested order (IN query doesn't preserve order)
  const idOrder = new Map(pageAuthorIds.map((id, i) => [id, i]));
  const sortedData = (data ?? []).sort((a: any, b: any) =>
    (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999)
  );

  const prospects: ProspectCard[] = sortedData.map((author: any) => {
    const articles: Article[] = (author.article_authors ?? []).map((aa: any) => aa.article).filter(Boolean);
    const allMentions = articles.flatMap((a: any) => (a.mentions ?? []).map((m: any) => m.tool_name));
    const uniqueTools = [...new Set(allMentions)];
    // Pick the score row with the highest composite so the badge always shows the author's best
    const score = (author.scores ?? []).sort((a: any, b: any) => (b.composite ?? 0) - (a.composite ?? 0))[0] ?? null;

    return {
      author: { ...author, contacts: undefined, scores: undefined, article_authors: undefined },
      articles,
      contacts: author.contacts ?? [],
      mentions: uniqueTools,
      score,
      domain: author.domain ?? null,
    };
  });

  return { prospects, total };
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [authors, domains, contacts, newAuthors] = await Promise.all([
    supabaseAdmin.from("authors").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("domains").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("contacts").select("author_id", { count: "exact", head: true }).not("author_id", "is", null),
    supabaseAdmin.from("authors").select("id", { count: "exact", head: true }).gte("created_at", oneWeekAgo),
  ]);

  const totalAuthors = authors.count ?? 0;
  const totalPublications = domains.count ?? 0;
  const contactable = contacts.count ?? 0;

  return {
    totalProspects: totalAuthors,
    totalAuthors,
    totalPublications,
    contactablePercent: totalAuthors > 0 ? Math.round((contactable / totalAuthors) * 100) : 0,
    newThisWeek: newAuthors.count ?? 0,
  };
}

export async function getToolMentionCounts(): Promise<{ tool: string; count: number }[]> {
  const { data, error } = await supabaseAdmin
    .from("mentions")
    .select("tool_name")
    .then(({ data, error }) => {
      if (error) return { data: null, error };
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.tool_name] = (counts[row.tool_name] ?? 0) + 1;
      }
      return {
        data: Object.entries(counts)
          .map(([tool, count]) => ({ tool, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20),
        error: null,
      };
    });
  return data ?? [];
}

export async function getFreshnessTimeline(): Promise<{ date: string; count: number }[]> {
  const { data } = await supabaseAdmin
    .from("articles")
    .select("published_at")
    .not("published_at", "is", null)
    .order("published_at", { ascending: true })
    .limit(500);

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const day = row.published_at!.slice(0, 10);
    counts[day] = (counts[day] ?? 0) + 1;
  }

  return Object.entries(counts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-90);
}

export async function getSourceProvenance(): Promise<{ source: string; count: number }[]> {
  const { data } = await supabaseAdmin.from("discovery_hits").select("source").eq("processed", true);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.source] = (counts[row.source] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getTopPublications(): Promise<{ name: string; host: string; count: number; avgScore: number }[]> {
  const { data } = await supabaseAdmin
    .from("domains")
    .select("name, host, authors(id, scores(composite))")
    .limit(20);

  return (data ?? [])
    .map((d: any) => {
      const authors = d.authors ?? [];
      const scores = authors.flatMap((a: any) => a.scores ?? []).map((s: any) => s.composite ?? 0);
      return {
        name: d.name ?? d.host,
        host: d.host,
        count: authors.length,
        avgScore: scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0,
      };
    })
    .filter((d: any) => d.count > 0)
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 10);
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export async function getCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Enrich with author counts
  const campaigns = data ?? [];
  const counts = await Promise.all(
    campaigns.map((c) =>
      supabaseAdmin
        .from("campaign_authors")
        .select("author_id", { count: "exact", head: true })
        .eq("campaign_id", c.id)
        .then(({ count }) => ({ id: c.id, count: count ?? 0 }))
    )
  );
  const countMap = new Map(counts.map((c) => [c.id, c.count]));
  return campaigns.map((c) => ({ ...c, author_count: countMap.get(c.id) ?? 0 }));
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

export async function createCampaign(data: { name: string; keywords: string[]; region?: string; target_hits?: number; seed_writer_name?: string; seed_article_url?: string }): Promise<Campaign> {
  const { data: campaign, error } = await supabaseAdmin
    .from("campaigns")
    .insert({ ...data, target_hits: data.target_hits ?? 2500, status: "draft" })
    .select()
    .single();
  if (error) throw error;
  return campaign;
}

export async function updateCampaign(id: string, data: Partial<Campaign>): Promise<void> {
  const { error } = await supabaseAdmin.from("campaigns").update(data).eq("id", id);
  if (error) throw error;
}

export async function getCampaignAuthorIds(campaignId: string): Promise<Set<string>> {
  const rows = await fetchAllRows<{ author_id: string }>(
    "campaign_authors",
    "author_id",
    (q) => q.eq("campaign_id", campaignId)
  );
  return new Set(rows.map((r) => r.author_id));
}

// Composite-score distribution for a candidate pool (a campaign's authors, or all) —
// so the workflow filter can show min/median/avg/max to guide the min-score threshold.
export async function getScoreStats(campaignId?: string): Promise<{ count: number; min: number; max: number; avg: number; median: number }> {
  const empty = { count: 0, min: 0, max: 0, avg: 0, median: 0 };
  let authorIds: Set<string> | null = null;
  if (campaignId) {
    authorIds = await getCampaignAuthorIds(campaignId);
    if (authorIds.size === 0) return empty;
  }
  const rows = await fetchAllRows<{ author_id: string; composite: number }>("scores", "author_id, composite");
  const byAuthor = new Map<string, number>(); // best composite per author
  for (const r of rows) {
    if (authorIds && !authorIds.has(r.author_id)) continue;
    const v = r.composite ?? 0;
    if (v > (byAuthor.get(r.author_id) ?? -1)) byAuthor.set(r.author_id, v);
  }
  const vals = [...byAuthor.values()].sort((a, b) => a - b);
  if (!vals.length) return empty;
  const sum = vals.reduce((s, v) => s + v, 0);
  return {
    count: vals.length,
    min: Math.round(vals[0]),
    max: Math.round(vals[vals.length - 1]),
    avg: Math.round(sum / vals.length),
    median: Math.round(vals[Math.floor(vals.length / 2)]),
  };
}

// Given a set of article URLs, return all author IDs linked to those articles.
// Used for campaign linking during reprocess, where processHit skips already-existing
// articles and so can't report their authors via its return value.
export async function getAuthorIdsForUrls(urls: string[]): Promise<string[]> {
  if (!urls.length) return [];

  // 1. URLs → article IDs
  const articleIds: string[] = [];
  for (let i = 0; i < urls.length; i += 300) {
    const chunk = urls.slice(i, i + 300);
    const rows = await fetchAllRows<{ id: string }>("articles", "id", (q) =>
      q.in("url_canonical", chunk)
    );
    articleIds.push(...rows.map((r) => r.id));
  }
  if (!articleIds.length) return [];

  // 2. article IDs → author IDs
  const authorIds = new Set<string>();
  for (let i = 0; i < articleIds.length; i += 300) {
    const chunk = articleIds.slice(i, i + 300);
    const rows = await fetchAllRows<{ author_id: string }>("article_authors", "author_id", (q) =>
      q.in("article_id", chunk)
    );
    for (const r of rows) authorIds.add(r.author_id);
  }

  return [...authorIds];
}

export async function linkAuthorsToCampaign(campaignId: string, authorIds: string[]): Promise<void> {
  if (!authorIds.length) return;
  const now = new Date().toISOString();
  const rows = authorIds.map((id) => ({ campaign_id: campaignId, author_id: id, discovered_at: now }));
  for (let i = 0; i < rows.length; i += 500) {
    await supabaseAdmin
      .from("campaign_authors")
      .upsert(rows.slice(i, i + 500), { onConflict: "campaign_id,author_id", ignoreDuplicates: true });
  }
}

// ─── Workflows ────────────────────────────────────────────────────────────────

export async function getWorkflows(campaignId?: string): Promise<Workflow[]> {
  let q = supabaseAdmin
    .from("workflows")
    .select("*, campaign:campaigns(id, name)")
    .order("created_at", { ascending: false });
  if (campaignId) q = q.eq("campaign_id", campaignId) as any;
  const { data, error } = await (q as any);
  if (error) throw error;
  return data ?? [];
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  const { data, error } = await supabaseAdmin
    .from("workflows")
    .select("*, campaign:campaigns(id, name)")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

export async function createWorkflow(data: { campaign_id?: string; name: string; filters?: WorkflowFilters }): Promise<Workflow> {
  const { data: workflow, error } = await supabaseAdmin
    .from("workflows")
    .insert({ ...data, filters: data.filters ?? {}, status: "draft" })
    .select("*, campaign:campaigns(id, name)")
    .single();
  if (error) throw error;
  return workflow;
}

export async function updateWorkflow(id: string, data: Partial<{ name: string; filters: WorkflowFilters; status: string; prospect_count: number }>): Promise<void> {
  const { error } = await supabaseAdmin.from("workflows").update(data).eq("id", id);
  if (error) throw error;
}

export async function saveWorkflowProspects(workflowId: string, prospects: { author_id: string; rank: number; included: boolean }[]): Promise<void> {
  // Clear existing prospects first
  await supabaseAdmin.from("workflow_prospects").delete().eq("workflow_id", workflowId);
  if (!prospects.length) return;
  const rows = prospects.map((p) => ({ workflow_id: workflowId, ...p }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("workflow_prospects").insert(rows.slice(i, i + 500));
    if (error) throw error;
  }
}

// Add ONE author to a workflow (from the search-and-add box). Idempotent: re-adds as
// included if already present, else appends after the last-ranked prospect.
export async function addWorkflowProspect(workflowId: string, authorId: string): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from("workflow_prospects").select("id").eq("workflow_id", workflowId).eq("author_id", authorId).maybeSingle();
  if (existing) {
    await supabaseAdmin.from("workflow_prospects").update({ included: true }).eq("id", (existing as any).id);
    return;
  }
  const { data: maxRow } = await supabaseAdmin
    .from("workflow_prospects").select("rank").eq("workflow_id", workflowId).order("rank", { ascending: false }).limit(1).maybeSingle();
  const rank = (((maxRow as any)?.rank as number) ?? 0) + 1;
  await supabaseAdmin.from("workflow_prospects").insert({ workflow_id: workflowId, author_id: authorId, included: true, rank });
}

export async function getWorkflowProspects(
  workflowId: string,
  opts?: { offset?: number; limit?: number }
): Promise<{ prospects: WorkflowProspect[]; total: number }> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const { count } = await supabaseAdmin
    .from("workflow_prospects")
    .select("id", { count: "exact", head: true })
    .eq("workflow_id", workflowId);

  const { data, error } = await supabaseAdmin
    .from("workflow_prospects")
    .select(`
      *,
      author:authors(
        *,
        domain:domains(*),
        contacts(*),
        article_authors(article:articles(*, mentions(*), domain:domains(*))),
        scores(*)
      )
    `)
    .eq("workflow_id", workflowId)
    .order("rank", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const prospects: WorkflowProspect[] = (data ?? []).map((row: any) => {
    const author = row.author ?? {};
    const articles = (author.article_authors ?? []).map((aa: any) => aa.article).filter(Boolean);
    const score = (author.scores ?? []).sort((a: any, b: any) => (b.composite ?? 0) - (a.composite ?? 0))[0] ?? null;
    return {
      id: row.id,
      workflow_id: row.workflow_id,
      author_id: row.author_id,
      included: row.included,
      rank: row.rank,
      created_at: row.created_at,
      author: { ...author, scores: undefined, article_authors: undefined },
      articles,
      contacts: author.contacts ?? [],
      score,
      domain: author.domain ?? null,
    };
  });

  return { prospects, total: count ?? 0 };
}

// Full detail for one author — profile + contacts + all their articles (newest first).
export async function getAuthorDetail(authorId: string): Promise<any | null> {
  const { data } = await supabaseAdmin
    .from("authors")
    .select(`*, domain:domains(*), contacts(*), article_authors(article:articles(*, domain:domains(*), mentions(*))), scores(*), flagged_content(*, article:articles(title, url_canonical))`)
    .eq("id", authorId)
    .maybeSingle();
  if (!data) return null;
  const articles = ((data as any).article_authors ?? [])
    .map((aa: any) => aa.article).filter(Boolean)
    .sort((a: any, b: any) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const flaggedContent = (data as any).flagged_content ?? [];
  const score = ((data as any).scores ?? []).sort((a: any, b: any) => (b.composite ?? 0) - (a.composite ?? 0))[0] ?? null;
  // ProspectCard.mentions is a string[] of tool names (deduped) — the drawer renders each as
  // a badge. Return names, not raw mention rows, or React throws on rendering an object.
  const mentions = [...new Set(
    articles.flatMap((a: any) => (a.mentions ?? []).map((m: any) => m.tool_name)).filter(Boolean)
  )];
  // Effective "contacted" state for the drawer's Emailed toggle.
  const { data: outreach } = await supabaseAdmin
    .from("outreach_emails").select("id").eq("author_id", authorId).in("status", ["sent", "scheduled"]).limit(1);
  const override = ((data as any).contacted_override ?? null) as boolean | null;
  const hasHistory = (outreach ?? []).length > 0;
  const contacted = override === true ? true : override === false ? false : hasHistory;
  return {
    author: { ...(data as any), article_authors: undefined, scores: undefined, flagged_content: undefined },
    domain: (data as any).domain ?? null,
    contacts: (data as any).contacts ?? [],
    articles,
    mentions,
    score,
    flaggedContent,
    contacted,
    contactedOverride: override,
    hasOutreachHistory: hasHistory,
  };
}

export async function toggleWorkflowProspect(workflowId: string, authorId: string, included: boolean): Promise<void> {
  const { error } = await supabaseAdmin
    .from("workflow_prospects")
    .update({ included })
    .eq("workflow_id", workflowId)
    .eq("author_id", authorId);
  if (error) throw error;
}

// Bulk set included for many (or all) prospects in a workflow in ONE request — used by
// Select all / Deselect all so it doesn't fire a PATCH per prospect.
export async function setWorkflowProspectsIncluded(
  workflowId: string, included: boolean, authorIds?: string[],
): Promise<void> {
  let q = supabaseAdmin.from("workflow_prospects").update({ included }).eq("workflow_id", workflowId);
  if (authorIds && authorIds.length) q = q.in("author_id", authorIds) as any;
  const { error } = await q;
  if (error) throw error;
}

// Run workflow filters against campaign authors (or all authors if no campaign)
export async function runWorkflowFilters(
  filters: WorkflowFilters,
  campaignId?: string
): Promise<{ author_id: string; rank: number }[]> {
  // Start with the candidate pool
  let candidateIds: Set<string> | null = null;

  if (campaignId) {
    candidateIds = await getCampaignAuthorIds(campaignId);
    if (candidateIds.size === 0) return [];
  }

  const filterSets: Set<string>[] = [];

  if (candidateIds) filterSets.push(candidateIds);

  if (filters.minScore && filters.minScore > 0) {
    const rows = await fetchAllRows<{ author_id: string }>("scores", "author_id", (q) =>
      q.gte("composite", filters.minScore)
    );
    filterSets.push(new Set(rows.map((r) => r.author_id)));
  }

  if (filters.tool && filters.tool !== "all") {
    const ments = await fetchAllRows<{ article_id: string }>("mentions", "article_id", (q) =>
      q.ilike("tool_name", `%${filters.tool}%`)
    );
    if (!ments.length) return [];
    const articleIds = [...new Set(ments.map((m) => m.article_id))];
    const aaRows: { author_id: string }[] = [];
    for (let i = 0; i < articleIds.length; i += 500) {
      const rows = await fetchAllRows<{ author_id: string }>("article_authors", "author_id", (q) =>
        q.in("article_id", articleIds.slice(i, i + 500))
      );
      aaRows.push(...rows);
    }
    filterSets.push(new Set(aaRows.map((r) => r.author_id)));
  }

  if (filters.archetype && filters.archetype !== "all") {
    const arts = await fetchAllRows<{ id: string }>("articles", "id", (q) =>
      q.eq("archetype", filters.archetype)
    );
    if (!arts.length) return [];
    const aaRows: { author_id: string }[] = [];
    for (let i = 0; i < arts.length; i += 500) {
      const rows = await fetchAllRows<{ author_id: string }>("article_authors", "author_id", (q) =>
        q.in("article_id", arts.slice(i, i + 500).map((a) => a.id))
      );
      aaRows.push(...rows);
    }
    filterSets.push(new Set(aaRows.map((r) => r.author_id)));
  }

  if (filters.hasContact) {
    // "Has email" means specifically an email contact — NOT any social handle.
    const rows = await fetchAllRows<{ author_id: string }>("contacts", "author_id", (q) =>
      q.eq("type", "mailto")
    );
    filterSets.push(new Set(rows.map((r) => r.author_id)));
  }

  // Email-status filter: has / verified (sourced) / guessed (pattern) / none / linkedin-no-email
  if (filters.emailStatus && filters.emailStatus !== "any") {
    const mailto = await fetchAllRows<{ author_id: string; source: string | null }>("contacts", "author_id, source", (q) => q.eq("type", "mailto"));
    const hasEmail = new Set(mailto.map((r) => r.author_id));
    if (filters.emailStatus === "has") filterSets.push(hasEmail);
    else if (filters.emailStatus === "guessed") filterSets.push(new Set(mailto.filter((r) => isGuessSource(r.source)).map((r) => r.author_id)));
    else if (filters.emailStatus === "verified") filterSets.push(new Set(mailto.filter((r) => !isGuessSource(r.source)).map((r) => r.author_id)));
    else if (filters.emailStatus === "none") {
      const allAuthors = await fetchAllRows<{ id: string }>("authors", "id");
      filterSets.push(new Set(allAuthors.map((r) => r.id).filter((id) => !hasEmail.has(id))));
    }
    else if (filters.emailStatus === "linkedin_no_email") {
      // Has a LinkedIn contact but no email yet — the sweet spot for the email finder (Blitz
      // can turn a LinkedIn into an email).
      const li = await fetchAllRows<{ author_id: string }>("contacts", "author_id", (q) => q.eq("type", "linkedin"));
      filterSets.push(new Set(li.map((r) => r.author_id).filter((id) => !hasEmail.has(id))));
    }
  }

  // "Only not-yet-emailed" — exclude anyone already sent/queued (any workflow) or manually
  // marked contacted; honors "email again" overrides via getContactedAuthorIds.
  if (filters.notContacted) {
    const contacted = await getContactedAuthorIds();
    const allAuthors = await fetchAllRows<{ id: string }>("authors", "id");
    filterSets.push(new Set(allAuthors.map((r) => r.id).filter((id) => !contacted.has(id))));
  }

  if (filters.region) {
    const rows = await fetchAllRows<{ id: string }>("domains", "id", (q) =>
      q.ilike("country", `%${filters.region}%`)
    );
    const domainIds = rows.map((r) => r.id);
    if (!domainIds.length) return [];
    const authorRows: { id: string }[] = [];
    for (let i = 0; i < domainIds.length; i += 500) {
      const chunk = await fetchAllRows<{ id: string }>("authors", "id", (q) =>
        q.in("primary_domain_id", domainIds.slice(i, i + 500))
      );
      authorRows.push(...chunk);
    }
    filterSets.push(new Set(authorRows.map((r) => r.id)));
  }

  // Intersect all filter sets
  let validIds: Set<string>;
  if (filterSets.length === 0) {
    // No filters — get all author IDs
    const all = await fetchAllRows<{ id: string }>("authors", "id");
    validIds = new Set(all.map((r) => r.id));
  } else {
    const sorted = [...filterSets].sort((a, b) => a.size - b.size);
    validIds = new Set(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      for (const id of validIds) {
        if (!sorted[i].has(id)) validIds.delete(id);
      }
    }
  }

  // Always exclude discarded authors — they're hidden from every workflow.
  const discardedRows = await fetchAllRows<{ id: string }>("authors", "id", (q) => q.eq("discarded", true));
  for (const r of discardedRows) validIds.delete(r.id);

  if (validIds.size === 0) return [];

  // Get score-sorted order
  const scoreRows = await fetchAllRows<{ author_id: string; composite: number }>("scores", "author_id, composite", (q) =>
    q.order("composite", { ascending: (filters.sortDir ?? "desc") === "asc" })
  );
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const r of scoreRows) {
    if (validIds.has(r.author_id) && !seen.has(r.author_id)) {
      seen.add(r.author_id);
      ordered.push(r.author_id);
    }
  }
  // Append authors with no scores
  for (const id of validIds) {
    if (!seen.has(id)) ordered.push(id);
  }

  const limit = filters.limit ?? 200;
  return ordered.slice(0, limit).map((id, i) => ({ author_id: id, rank: i + 1 }));
}

// ─── Email Templates ──────────────────────────────────────────────────────────

export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  const { data, error } = await supabaseAdmin
    .from("email_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getEmailTemplate(id: string): Promise<EmailTemplate | null> {
  const { data, error } = await supabaseAdmin.from("email_templates").select("*").eq("id", id).single();
  if (error) return null;
  return data;
}

export async function createEmailTemplate(data: { name: string; subject: string; body: string; guidance?: string; channel?: "email" | "linkedin" }): Promise<EmailTemplate> {
  const { data: tmpl, error } = await supabaseAdmin
    .from("email_templates")
    .insert({ ...data, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return tmpl;
}

export async function updateEmailTemplate(id: string, data: { name?: string; subject?: string; body?: string; guidance?: string; channel?: "email" | "linkedin" }): Promise<void> {
  const { error } = await supabaseAdmin
    .from("email_templates")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteEmailTemplate(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("email_templates").delete().eq("id", id);
  if (error) throw error;
}

// ─── LinkedIn Messages (generated connection notes, copy-paste — never sent) ────

export async function getLinkedinMessages(workflowId: string): Promise<LinkedinMessage[]> {
  const { data, error } = await supabaseAdmin
    .from("linkedin_messages")
    .select("*")
    .eq("workflow_id", workflowId);
  if (error) throw error;
  return data ?? [];
}

// Overwrite the note for one prospect (upsert on workflow_id+author_id — same shape
// as outreach emails, so re-generating or hand-editing just replaces it).
export async function upsertLinkedinMessage(data: {
  workflow_id: string;
  author_id: string;
  template_id?: string | null;
  body: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("linkedin_messages")
    .upsert({ ...data, updated_at: new Date().toISOString() }, { onConflict: "workflow_id,author_id" });
  if (error) throw error;
}

// ─── Outreach Emails ──────────────────────────────────────────────────────────

export async function getWorkflowEmails(workflowId: string): Promise<OutreachEmail[]> {
  const { data, error } = await supabaseAdmin
    .from("outreach_emails")
    .select("*, author:authors(id, full_name, avatar_url, primary_domain_id, domain:domains(name, host))")
    .eq("workflow_id", workflowId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// One outreach email with its resolved recipient (mailto) — for the per-email "Send now".
export async function getOutreachEmailWithRecipient(id: string): Promise<(OutreachEmail & { recipient?: string }) | null> {
  const { data } = await supabaseAdmin
    .from("outreach_emails")
    .select("*, author:authors(contacts(type, value))")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const mailto = ((data as any).author?.contacts ?? []).find((c: any) => c.type === "mailto");
  return { ...(data as any), recipient: mailto ? (mailto.value as string).replace(/^mailto:/, "") : undefined };
}

export async function getOutreachEmail(id: string): Promise<OutreachEmail | null> {
  const { data, error } = await supabaseAdmin
    .from("outreach_emails")
    .select("*, author:authors(*, domain:domains(*))")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

export async function upsertOutreachEmail(data: {
  workflow_id: string;
  author_id: string;
  template_id?: string;
  subject?: string;
  body?: string;
  status?: string;
}): Promise<OutreachEmail> {
  const { data: email, error } = await supabaseAdmin
    .from("outreach_emails")
    .upsert(
      { ...data, kind: "initial", status: data.status ?? "draft" },
      { onConflict: "workflow_id,author_id,kind" }
    )
    .select()
    .single();
  if (error) throw error;
  return email;
}

export async function updateOutreachEmail(id: string, data: {
  subject?: string;
  body?: string;
  status?: string;
  scheduled_at?: string | null; // null = unschedule (cancel a queued send)
  sent_at?: string | null;
  error?: string | null;
  replied_at?: string | null; // set by IMAP reply detection
  message_id?: string | null; // RFC Message-ID we sent with, for reply threading
  followup_skipped?: boolean;  // per-email safety valve for auto follow-ups
  success_at?: string | null;
  success_link?: string | null;
  success_notes?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("outreach_emails").update(data).eq("id", id);
  if (error) throw error;
}

// ─── Reply detection (IMAP) ─────────────────────────────────────────────────────

// Outstanding sent emails (last N days, no reply yet) grouped by the mailbox that sent
// them, with the recipient + subject needed for reply matching. sender_email "" = legacy
// env-sender sends (checked against the env SMTP account).
export async function getOutstandingSentForReplyCheck(days = 30): Promise<Map<string, Array<{ id: string; message_id: string | null; recipient: string; subject: string; sent_at: string }>>> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, sender_email, message_id, subject, sent_at, author:authors(contacts(type, value))")
    .eq("status", "sent")
    .is("replied_at", null)
    .gte("sent_at", since)
    .limit(2000);
  const out = new Map<string, Array<{ id: string; message_id: string | null; recipient: string; subject: string; sent_at: string }>>();
  for (const e of data ?? []) {
    const mailto = ((e as any).author?.contacts ?? []).find((c: any) => c.type === "mailto");
    const recipient = mailto ? (mailto.value as string).replace(/^mailto:/, "") : "";
    if (!recipient) continue;
    const key = (e as any).sender_email ?? "";
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push({ id: e.id, message_id: (e as any).message_id ?? null, recipient, subject: e.subject ?? "", sent_at: (e as any).sent_at });
  }
  return out;
}

export async function markEmailsReplied(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await supabaseAdmin.from("outreach_emails").update({ replied_at: new Date().toISOString() }).in("id", ids).is("replied_at", null);
}

export async function markRepliesChecked(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await supabaseAdmin.from("outreach_emails").update({ reply_checked_at: new Date().toISOString() }).in("id", ids);
}

// ─── Auto follow-ups ────────────────────────────────────────────────────────────

// A newly-scheduled follow-up sends this far in the future, giving a visible date and a
// window to toggle it off before it goes out. Candidates are already >2 days past their
// initial send, so this is the review buffer, not the 2-day wait itself.
export const FOLLOWUP_LEAD_MS = 24 * 60 * 60 * 1000;

// Initial sends older than `days` with no reply, no success, not skipped, and no follow-up
// yet — the candidates for an automatic threaded follow-up.
export async function getEmailsNeedingFollowup(days = 2, limit = 25): Promise<Array<{
  id: string; workflow_id: string; author_id: string; template_id: string | null;
  subject: string; sender_email: string | null; sent_by_email: string | null; message_id: string | null;
  recipient: string; author_name: string; publication: string; guidance: string | null;
}>> {
  const before = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, workflow_id, author_id, template_id, subject, sender_email, sent_by_email, message_id, author:authors(full_name, contacts(type, value), domain:domains(name, host))")
    .eq("status", "sent").eq("kind", "initial")
    .is("replied_at", null).is("success_at", null).eq("followup_skipped", false)
    .lte("sent_at", before)
    .order("sent_at", { ascending: true })
    .limit(limit * 3); // over-fetch; we filter out ones that already have a follow-up child
  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Exclude any that already have a follow-up child.
  const ids = rows.map((r) => r.id);
  const { data: kids } = await supabaseAdmin.from("outreach_emails").select("parent_id").eq("kind", "followup").in("parent_id", ids);
  const hasChild = new Set((kids ?? []).map((k: any) => k.parent_id));

  // Load each involved template's guidance once.
  const templateIds = [...new Set(rows.map((r) => (r as any).template_id).filter(Boolean))] as string[];
  const guidanceById = new Map<string, string | null>();
  if (templateIds.length > 0) {
    const { data: tpls } = await supabaseAdmin.from("email_templates").select("id, guidance").in("id", templateIds);
    for (const t of tpls ?? []) guidanceById.set(t.id, (t as any).guidance ?? null);
  }

  const out: any[] = [];
  for (const r of rows) {
    if (hasChild.has(r.id)) continue;
    const a: any = (r as any).author ?? {};
    const mailto = (a.contacts ?? []).find((c: any) => c.type === "mailto");
    const recipient = mailto ? (mailto.value as string).replace(/^mailto:/, "") : "";
    if (!recipient) continue;
    out.push({
      id: r.id, workflow_id: r.workflow_id, author_id: r.author_id, template_id: (r as any).template_id ?? null,
      subject: r.subject ?? "", sender_email: (r as any).sender_email ?? null, sent_by_email: (r as any).sent_by_email ?? null,
      message_id: (r as any).message_id ?? null, recipient,
      author_name: a.full_name ?? "there", publication: a.domain?.name ?? a.domain?.host ?? "your work",
      guidance: (r as any).template_id ? guidanceById.get((r as any).template_id) ?? null : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Insert the follow-up as its own row (kind='followup') linked to its parent, then it's
// delivered + stamped sent by the caller.
export async function createFollowupRow(data: {
  workflow_id: string; author_id: string; parent_id: string; subject: string; body: string;
  sender_email: string | null; sent_by_email: string | null;
  status?: string; scheduled_at?: string | null;
}): Promise<{ id: string }> {
  const { data: row, error } = await supabaseAdmin
    .from("outreach_emails")
    .insert({
      workflow_id: data.workflow_id, author_id: data.author_id, parent_id: data.parent_id,
      kind: "followup", subject: data.subject, body: data.body,
      status: data.status ?? "ready", scheduled_at: data.scheduled_at ?? null,
      sender_email: data.sender_email, sent_by_email: data.sent_by_email,
    })
    .select("id").single();
  if (error) throw error;
  return row;
}

// Arm / disarm a single scheduled follow-up. Disarming parks the follow-up (status='draft',
// no schedule) AND marks its parent followup_skipped so runFollowups never regenerates it.
// Re-arming reschedules it and clears the parent flag. Only meaningful while it's unsent.
export async function setFollowupArmed(followupId: string, armed: boolean): Promise<{ ok: boolean; error?: string }> {
  const { data: fu } = await supabaseAdmin
    .from("outreach_emails").select("id, parent_id, status, kind").eq("id", followupId).single();
  if (!fu || (fu as any).kind !== "followup") return { ok: false, error: "not a follow-up" };
  if ((fu as any).status === "sent") return { ok: false, error: "already sent" };
  if (armed) {
    const when = new Date(Date.now() + FOLLOWUP_LEAD_MS).toISOString();
    await supabaseAdmin.from("outreach_emails").update({ status: "scheduled", scheduled_at: when, error: null }).eq("id", followupId);
    if ((fu as any).parent_id) await supabaseAdmin.from("outreach_emails").update({ followup_skipped: false }).eq("id", (fu as any).parent_id);
  } else {
    await supabaseAdmin.from("outreach_emails").update({ status: "draft", scheduled_at: null }).eq("id", followupId);
    if ((fu as any).parent_id) await supabaseAdmin.from("outreach_emails").update({ followup_skipped: true }).eq("id", (fu as any).parent_id);
  }
  return { ok: true };
}

// The threading + engagement info a follow-up needs at send time: the parent's Message-ID
// (to thread the reply) and whether the parent has since been replied to / converted.
export async function getFollowupParent(parentId: string): Promise<{ message_id: string | null; replied_at: string | null; success_at: string | null } | null> {
  const { data } = await supabaseAdmin
    .from("outreach_emails").select("message_id, replied_at, success_at").eq("id", parentId).single();
  if (!data) return null;
  return { message_id: (data as any).message_id ?? null, replied_at: (data as any).replied_at ?? null, success_at: (data as any).success_at ?? null };
}

// Authors that lack an email (no mailto contact), optionally scoped to one campaign.
// Returns id + name + publication domain host so the finder can run the waterfall.
export async function getAuthorsNeedingEmail(campaignId?: string, onlyNew = false): Promise<Array<{ id: string; name: string; host: string; publication: string }>> {
  let candidateIds: Set<string> | null = null;
  if (campaignId) {
    candidateIds = await getCampaignAuthorIds(campaignId);
    if (candidateIds.size === 0) return [];
  }

  // authors that already have a mailto contact — to exclude
  const withEmail = new Set(
    (await fetchAllRows<{ author_id: string }>("contacts", "author_id", (q) => q.eq("type", "mailto"))).map((r) => r.author_id)
  );

  const rows = await fetchAllRows<{ id: string; full_name: string; email_search_attempted_at: string | null; domain: { host: string; name: string } | null }>(
    "authors",
    "id, full_name, email_search_attempted_at, domain:domains!primary_domain_id(host, name)",
    (q) => q.not("primary_domain_id", "is", null),
  );

  return rows
    .filter((r) => !withEmail.has(r.id))
    .filter((r) => !onlyNew || !r.email_search_attempted_at) // "brand new" = never attempted before, regardless of outcome
    .filter((r) => !candidateIds || candidateIds.has(r.id))
    .filter((r) => r.domain?.host)
    .map((r) => ({ id: r.id, name: r.full_name, host: r.domain!.host, publication: r.domain!.name ?? r.domain!.host }));
}

export async function markEmailSearchAttempted(authorId: string): Promise<void> {
  await supabaseAdmin.from("authors").update({ email_search_attempted_at: new Date().toISOString() }).eq("id", authorId);
}

// Authors (in a campaign, or all) that DON'T yet have a stored LinkedIn contact — the
// targets for the LinkedIn finder's one-time pass. LinkedIn is higher-hit-rate than email.
export async function getAuthorsNeedingLinkedin(campaignId?: string): Promise<Array<{ id: string; name: string; host: string; publication: string }>> {
  let candidateIds: Set<string> | null = null;
  if (campaignId) {
    candidateIds = await getCampaignAuthorIds(campaignId);
    if (candidateIds.size === 0) return [];
  }

  const withLinkedin = new Set(
    (await fetchAllRows<{ author_id: string }>("contacts", "author_id", (q) => q.eq("type", "linkedin"))).map((r) => r.author_id)
  );

  const rows = await fetchAllRows<{ id: string; full_name: string; domain: { host: string; name: string } | null }>(
    "authors",
    "id, full_name, domain:domains!primary_domain_id(host, name)",
    (q) => q.not("primary_domain_id", "is", null),
  );

  return rows
    .filter((r) => !withLinkedin.has(r.id))
    .filter((r) => !candidateIds || candidateIds.has(r.id))
    .filter((r) => r.domain?.host)
    .map((r) => ({ id: r.id, name: r.full_name, host: r.domain!.host, publication: r.domain!.name ?? r.domain!.host }));
}

// Denominator + numerator for the Email/LinkedIn finder: how many prospects in the pool
// (campaign, or all authors with a publication) still lack an email (or LinkedIn), of the
// total pool. Matches the finder's own target set.
export async function getFinderCounts(campaignId: string | undefined, mode: "email" | "linkedin", onlyNew = false): Promise<{ total: number; needing: number }> {
  const candidateIds = campaignId ? await getCampaignAuthorIds(campaignId) : null;
  if (candidateIds && candidateIds.size === 0) return { total: 0, needing: 0 };

  const type = mode === "linkedin" ? "linkedin" : "mailto";
  const withContact = new Set(
    (await fetchAllRows<{ author_id: string }>("contacts", "author_id", (q) => q.eq("type", type))).map((r) => r.author_id)
  );
  const rows = await fetchAllRows<{ id: string; email_search_attempted_at: string | null; domain: { host: string } | null }>(
    "authors", "id, email_search_attempted_at, domain:domains!primary_domain_id(host)", (q) => q.not("primary_domain_id", "is", null),
  );
  const pool = rows.filter((r) => r.domain?.host && (!candidateIds || candidateIds.has(r.id)));
  return {
    total: pool.length,
    needing: pool.filter((r) => !withContact.has(r.id) && (mode === "linkedin" || !onlyNew || !r.email_search_attempted_at)).length,
  };
}

// Known (author name, email) pairs for a domain — used to infer the domain's email
// pattern for free. Pools every author whose publication is on the SAME registrable domain
// (www.ibm.com + research.ibm.com + newsroom.ibm.com → one ibm.com pattern) so subdomains
// don't each infer a different pattern. Over-fetches by host-substring, then filters exactly.
export async function getKnownEmailsByDomain(host: string): Promise<Array<{ name: string; email: string }>> {
  const reg = registrableDomain(host);
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("value, author:authors!inner(full_name, domain:domains!primary_domain_id!inner(host))")
    .eq("type", "mailto")
    .ilike("author.domain.host", `%${reg}`)
    .limit(500);
  return (data ?? [])
    .map((r: any) => ({
      name: r.author?.full_name as string,
      email: (r.value as string).replace(/^mailto:/, "").toLowerCase(),
      host: (r.author?.domain?.host ?? "") as string,
    }))
    .filter((r: any) => r.name && r.email)
    // Precise match on BOTH sides: the author's publication AND the email must be on this
    // exact registrable domain. `%ibm.com` also catches `notibm.com`, so re-check host here.
    // And a Fast Company writer whose contact is a personal gmail must not poison inference.
    .filter((r: any) => registrableDomain(r.host) === reg && registrableDomain(r.email.split("@")[1] ?? "") === reg)
    .map((r: any) => ({ name: r.name, email: r.email }));
}

// An author's already-stored LinkedIn URL, if any — so the email cascade can reuse it and
// skip the (paid) web search + post scan. Normalized to an absolute https URL.
export async function getStoredLinkedin(authorId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("contacts").select("value").eq("author_id", authorId).eq("type", "linkedin").limit(1).maybeSingle();
  const v = (data as any)?.value as string | undefined;
  if (!v) return null;
  return v.startsWith("http") ? v : `https://${v}`;
}

// All of an author's article URLs (most recent first, capped) — scraped during
// enrichment to hunt for their LinkedIn / contact info across everything they wrote.
export async function getAuthorArticleUrls(authorId: string, limit = 50): Promise<string[]> {
  const aa = await fetchAllRows<{ article_id: string }>("article_authors", "article_id", (q) => q.eq("author_id", authorId));
  if (!aa.length) return [];
  const ids = aa.map((r) => r.article_id).slice(0, 500);
  const urls: string[] = [];
  for (let i = 0; i < ids.length && urls.length < limit; i += 200) {
    const { data } = await supabaseAdmin
      .from("articles")
      .select("url_canonical, published_at")
      .in("id", ids.slice(i, i + 200))
      .order("published_at", { ascending: false });
    urls.push(...(data ?? []).map((r: any) => r.url_canonical).filter(Boolean));
  }
  return urls.slice(0, limit);
}

// Persist inferred author timezones (authorId → IANA tz) so we only infer once.
export async function setAuthorTimezones(map: Record<string, string>): Promise<void> {
  const entries = Object.entries(map);
  for (const [authorId, tz] of entries) {
    await supabaseAdmin.from("authors").update({ timezone: tz }).eq("id", authorId).then(() => {});
  }
}

// ─── Enrichment run history ─────────────────────────────────────────────────
export async function saveEnrichmentRun(run: {
  key: string; campaignName?: string; total: number; done: number; found: number;
  bySource: Record<string, number>; people: any[]; startedAt: number;
}): Promise<void> {
  await supabaseAdmin.from("enrichment_runs").insert({
    campaign_id: run.key, campaign_name: run.campaignName ?? null,
    total: run.total, done: run.done, found: run.found,
    by_source: run.bySource, people: run.people,
    started_at: new Date(run.startedAt).toISOString(), finished_at: new Date().toISOString(),
  }).then(() => {});
}

export async function getEnrichmentRuns(limit = 25): Promise<any[]> {
  const { data } = await supabaseAdmin
    .from("enrichment_runs")
    .select("id, campaign_name, total, done, found, by_source, started_at, finished_at")
    .order("finished_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getEnrichmentRun(id: string): Promise<any | null> {
  const { data } = await supabaseAdmin.from("enrichment_runs").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

// Author IDs already contacted (or queued) in OTHER campaigns/workflows — so we never
// email the same person twice across campaigns. "Contacted" = a sent or scheduled
// outreach email in any workflow other than the one given.
export async function getContactedAuthorIds(excludeWorkflowId?: string): Promise<Set<string>> {
  const rows = await fetchAllRows<{ author_id: string; workflow_id: string }>(
    "outreach_emails",
    "author_id, workflow_id",
    (q) => q.in("status", ["sent", "scheduled"]),
  );
  const set = new Set<string>();
  for (const r of rows) {
    if (excludeWorkflowId && r.workflow_id === excludeWorkflowId) continue;
    set.add(r.author_id);
  }
  // Apply manual overrides from the prospect drawer: true → force contacted, false → force
  // NOT contacted ("email them again"). This wins over the derived history above.
  const overrides = await fetchAllRows<{ id: string; contacted_override: boolean | null }>(
    "authors", "id, contacted_override", (q) => q.not("contacted_override", "is", null),
  );
  for (const o of overrides) {
    if (o.contacted_override === true) set.add(o.id);
    else if (o.contacted_override === false) set.delete(o.id);
  }
  return set;
}

// Manual override of an author's contacted state (from the prospect drawer's "Emailed"
// toggle). Pass null to clear it and fall back to derived-from-outreach behavior.
export async function setContactedOverride(authorId: string, value: boolean | null): Promise<void> {
  await supabaseAdmin.from("authors").update({ contacted_override: value }).eq("id", authorId);
}

// Discard an author — hidden from every workflow (runWorkflowFilters excludes discarded).
export async function setAuthorDiscarded(authorId: string, discarded: boolean): Promise<void> {
  await supabaseAdmin.from("authors").update({ discarded }).eq("id", authorId);
}

// Whether ONE author counts as contacted right now (derived history OR manual override).
export async function isAuthorContacted(authorId: string): Promise<{ contacted: boolean; override: boolean | null; hasHistory: boolean }> {
  const [{ data: author }, { data: emails }] = await Promise.all([
    supabaseAdmin.from("authors").select("contacted_override").eq("id", authorId).maybeSingle(),
    supabaseAdmin.from("outreach_emails").select("id").eq("author_id", authorId).in("status", ["sent", "scheduled"]).limit(1),
  ]);
  const override = (author?.contacted_override ?? null) as boolean | null;
  const hasHistory = (emails ?? []).length > 0;
  const contacted = override === true ? true : override === false ? false : hasHistory;
  return { contacted, override, hasHistory };
}

// ─── Per-user email config (own Gmail + own schedule) ──────────────────────────

const DEFAULT_USER_CONFIG = { timezone: "America/New_York", send_hour_start: 9, send_hour_end: 17, gap_minutes: 15, daily_cap: 50 };

// Client-safe config (no password). Returns defaults (hasPassword=false) if unset.
export async function getUserEmailConfig(userEmail: string): Promise<import("@/lib/types").UserEmailConfig> {
  const { data } = await supabaseAdmin.from("user_email_config").select("*").eq("user_email", userEmail).maybeSingle();
  return {
    user_email: userEmail,
    from_name: data?.from_name ?? undefined,
    timezone: data?.timezone ?? DEFAULT_USER_CONFIG.timezone,
    send_hour_start: data?.send_hour_start ?? DEFAULT_USER_CONFIG.send_hour_start,
    send_hour_end: data?.send_hour_end ?? DEFAULT_USER_CONFIG.send_hour_end,
    gap_minutes: data?.gap_minutes ?? DEFAULT_USER_CONFIG.gap_minutes,
    daily_cap: data?.daily_cap ?? DEFAULT_USER_CONFIG.daily_cap,
    hasPassword: !!data?.app_password_enc,
  };
}

export async function upsertUserEmailConfig(userEmail: string, data: {
  app_password_enc?: string; from_name?: string; timezone?: string;
  send_hour_start?: number; send_hour_end?: number; gap_minutes?: number; daily_cap?: number;
  shared_sender_label?: string | null; shared_sender_enabled?: boolean;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("user_email_config")
    .upsert({ user_email: userEmail, ...data, updated_at: new Date().toISOString() }, { onConflict: "user_email" });
  if (error) throw error;
}

// Server-only: the encrypted app password for a sender (decrypted by the caller at send time).
export async function getUserAppPasswordEnc(userEmail: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("user_email_config").select("app_password_enc").eq("user_email", userEmail).maybeSingle();
  return (data?.app_password_enc as string | undefined) ?? null;
}

// ─── Shared sending identities (e.g. Zain) — admin-managed, DB-driven ──────────────

export interface SharedSenderRow { email: string; label: string; enabled: boolean; hasPassword: boolean }

// Every configured shared sender, enabled or not — for the Admin management list.
export async function getSharedSenders(): Promise<SharedSenderRow[]> {
  const { data, error } = await supabaseAdmin
    .from("user_email_config")
    .select("user_email, shared_sender_label, shared_sender_enabled, app_password_enc")
    .not("shared_sender_label", "is", null);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    email: r.user_email, label: r.shared_sender_label, enabled: r.shared_sender_enabled, hasPassword: !!r.app_password_enc,
  }));
}

// Only the ones currently toggled on — for the "Send from" picker and for validating a
// chosen sender_email is actually allowed right now.
export async function getEnabledSharedSenders(): Promise<{ email: string; label: string }[]> {
  const { data, error } = await supabaseAdmin
    .from("user_email_config")
    .select("user_email, shared_sender_label")
    .not("shared_sender_label", "is", null)
    .eq("shared_sender_enabled", true);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ email: r.user_email, label: r.shared_sender_label }));
}

// For display purposes (e.g. labeling past sends) — returns the label even if since
// disabled, so history still reads "from Zain" after a toggle-off.
export async function getSharedSenderLabel(email: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("user_email_config").select("shared_sender_label").eq("user_email", email).maybeSingle();
  return (data as any)?.shared_sender_label ?? null;
}

// ─── Email send config & scheduling ─────────────────────────────────────────────

const DEFAULT_SEND_CONFIG = {
  timezone: "America/New_York",
  send_hour_start: 9,
  send_hour_end: 17,
  gap_minutes: 15,
  daily_cap: 50,
  provider: "smtp" as const,
};

export async function getSendConfig(workflowId: string): Promise<EmailSendConfig | null> {
  const { data } = await supabaseAdmin
    .from("email_send_config")
    .select("*")
    .eq("workflow_id", workflowId)
    .maybeSingle();
  return data ?? null;
}

// Returns the stored config, or a sensible default (not persisted) so callers always have one.
export async function getSendConfigOrDefault(workflowId: string): Promise<EmailSendConfig> {
  const existing = await getSendConfig(workflowId);
  if (existing) return existing;
  return { id: "", workflow_id: workflowId, created_at: new Date().toISOString(), ...DEFAULT_SEND_CONFIG };
}

export async function upsertSendConfig(workflowId: string, data: Partial<EmailSendConfig>): Promise<EmailSendConfig> {
  const { data: row, error } = await supabaseAdmin
    .from("email_send_config")
    .upsert({ workflow_id: workflowId, ...data }, { onConflict: "workflow_id" })
    .select()
    .single();
  if (error) throw error;
  return row;
}

// Assign scheduled_at times to a workflow's ready/included emails, in rank order.
// `times` is a parallel array of ISO strings (one per email, in order).
export async function scheduleWorkflowEmails(
  workflowId: string,
  emailIdsInOrder: string[],
  times: string[],
  senderEmail?: string,
  sentByEmail?: string, // who actually clicked Send — tracked separately when sending as a shared inbox
): Promise<void> {
  for (let i = 0; i < emailIdsInOrder.length && i < times.length; i++) {
    const patch: Record<string, unknown> = { scheduled_at: times[i], status: "scheduled", error: null };
    if (senderEmail) patch.sender_email = senderEmail; // whose mailbox this sends from
    if (sentByEmail) patch.sent_by_email = sentByEmail;
    await supabaseAdmin.from("outreach_emails").update(patch).eq("id", emailIdsInOrder[i]);
  }
}

// Reschedule every currently-queued email into a new standardised timezone. Recomputes each
// workflow's queue with computeSmartSchedule (its own window/spacing/cap, the new timezone
// for all) and persists the timezone to that workflow's config. Returns how many moved.
export async function rescheduleScheduledToTimezone(timezone: string): Promise<number> {
  const { computeSmartSchedule } = await import("@/lib/email/schedule");
  const rows = await fetchAllRows<{ id: string; workflow_id: string; scheduled_at: string | null }>(
    "outreach_emails", "id, workflow_id, scheduled_at", (q) => q.eq("status", "scheduled"),
  );
  const byWf = new Map<string, string[]>();
  for (const r of rows.sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""))) {
    if (!byWf.has(r.workflow_id)) byWf.set(r.workflow_id, []);
    byWf.get(r.workflow_id)!.push(r.id);
  }
  let moved = 0;
  const now = new Date();
  for (const [workflowId, ids] of byWf) {
    const config = await getSendConfigOrDefault(workflowId);
    const slots = computeSmartSchedule(ids.map((id) => ({ id, tz: timezone })), { ...config, timezone }, now);
    await scheduleWorkflowEmails(workflowId, slots.map((s) => s.id), slots.map((s) => s.at));
    await upsertSendConfig(workflowId, { timezone }).catch(() => {});
    moved += ids.length;
  }
  return moved;
}

// Sending status for the progress page. Counts are ALL-TIME (via exact count queries, not
// a capped page), so the top stats reflect the entirety of sending history. The queued and
// sent/failed lists are paginated so the UI can "load more" back through everything.
const SEND_COLS = "id, workflow_id, author_id, sender_email, sent_by_email, subject, status, kind, parent_id, scheduled_at, sent_at, error, replied_at, success_at, success_link, success_notes, author:authors(full_name, timezone, contacts(type, source), domain:domains(host, country, name))";

export async function getSendingStatus(opts: {
  workflowId?: string;
  upcomingOffset?: number; upcomingLimit?: number;
  recentOffset?: number; recentLimit?: number;
  followupOffset?: number; followupLimit?: number;
} = {}): Promise<{
  counts: Record<string, number>;
  upcoming: any[]; upcomingTotal: number;
  recent: any[]; recentTotal: number;
  followups: any[]; followupsTotal: number;
}> {
  const { workflowId } = opts;
  const upcomingOffset = opts.upcomingOffset ?? 0;
  const upcomingLimit = opts.upcomingLimit ?? 50;
  const recentOffset = opts.recentOffset ?? 0;
  const recentLimit = opts.recentLimit ?? 40;
  const followupOffset = opts.followupOffset ?? 0;
  const followupLimit = opts.followupLimit ?? 200;

  const scoped = (q: any) => (workflowId ? q.eq("workflow_id", workflowId) : q);
  const countOf = (build: (q: any) => any) =>
    build(scoped(supabaseAdmin.from("outreach_emails").select("id", { count: "exact", head: true })))
      .then(({ count }: any) => count ?? 0);

  // Initials and follow-ups are counted/listed separately so follow-ups only ever surface in
  // the Follow-ups tab (never mixed into Queued or Sent & failed). ROI denominators use the
  // count of *initials* sent (people contacted), not raw sends, so follow-ups don't inflate it.
  const [
    cSentInitial, cFailedInitial, cReplied, cSuccess,
    queuedTotal, recentTotal, followupsTotal,
    { data: upcoming }, { data: recent }, { data: followups },
  ] = await Promise.all([
    countOf((q) => q.eq("status", "sent").eq("kind", "initial")),
    countOf((q) => q.eq("status", "failed").eq("kind", "initial")),
    countOf((q) => q.not("replied_at", "is", null).eq("kind", "initial")),
    countOf((q) => q.not("success_at", "is", null)),
    countOf((q) => q.eq("status", "scheduled").eq("kind", "initial")),
    // Sent & failed is the chronological record of everything that actually went out —
    // initials AND sent/failed follow-ups (pending follow-ups stay only in the Follow-ups tab).
    countOf((q) => q.in("status", ["sent", "failed"])),
    countOf((q) => q.eq("kind", "followup")),
    scoped(supabaseAdmin.from("outreach_emails").select(SEND_COLS))
      .eq("status", "scheduled").eq("kind", "initial")
      .order("scheduled_at", { ascending: true }).range(upcomingOffset, upcomingOffset + upcomingLimit - 1),
    scoped(supabaseAdmin.from("outreach_emails").select(SEND_COLS))
      .in("status", ["sent", "failed"])
      .order("sent_at", { ascending: false, nullsFirst: false }).range(recentOffset, recentOffset + recentLimit - 1),
    // Follow-ups of every status (scheduled/sent/failed/draft) — scheduled (sent_at null) first
    // so armed, not-yet-sent ones sort to the top, then sent by recency.
    scoped(supabaseAdmin.from("outreach_emails").select(SEND_COLS))
      .eq("kind", "followup")
      .order("sent_at", { ascending: false, nullsFirst: true }).range(followupOffset, followupOffset + followupLimit - 1),
  ]);

  const counts: Record<string, number> = {
    scheduled: queuedTotal, ready: 0, draft: 0,
    sent: cSentInitial, failed: cFailedInitial, replied: cReplied, success: cSuccess,
    followups: followupsTotal,
  };
  return {
    counts,
    upcoming: upcoming ?? [], upcomingTotal: queuedTotal,
    recent: recent ?? [], recentTotal,
    followups: followups ?? [], followupsTotal,
  };
}

// Emails that are due to send now (scheduled and their time has passed).
export async function getDueEmails(limit = 25): Promise<Array<OutreachEmail & { recipient?: string }>> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("outreach_emails")
    .select("*, author:authors(id, full_name, contacts(type, value))")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((e: any) => {
    const mailto = (e.author?.contacts ?? []).find((c: any) => c.type === "mailto");
    return { ...e, recipient: mailto ? mailto.value.replace(/^mailto:/, "") : undefined };
  });
}

// ─── Author-watch notifications ────────────────────────────────────────────────

export async function addAuthorWatch(userEmail: string, authorId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("author_watches")
    .upsert({ user_email: userEmail, author_id: authorId }, { onConflict: "user_email,author_id" });
  if (error) throw error;
}

export async function removeAuthorWatch(userEmail: string, authorId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("author_watches")
    .delete()
    .eq("user_email", userEmail)
    .eq("author_id", authorId);
  if (error) throw error;
}

export async function getUserWatches(userEmail: string): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from("author_watches")
    .select("author_id, created_at, last_checked_at, author:authors(id, full_name, avatar_url, domain:domains(host, name), contacts(type, value))")
    .eq("user_email", userEmail)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Every author watched by ANYONE, deduped — the daily check runs once per author, not once
// per watcher, then fans notifications out to everyone watching that author.
export async function getDistinctWatchedAuthors(limit = 200): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from("author_watches")
    .select("author_id, author:authors(id, full_name, primary_domain_id, contacts(type, value), domain:domains!primary_domain_id(host))")
    .order("last_checked_at", { ascending: true, nullsFirst: true }) // stalest-checked first
    .limit(limit);
  if (error) throw error;
  const seen = new Map<string, any>();
  for (const row of data ?? []) {
    if (!seen.has(row.author_id)) seen.set(row.author_id, row.author);
  }
  return [...seen.values()].filter(Boolean);
}

export async function getWatchersOf(authorId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from("author_watches").select("user_email").eq("author_id", authorId);
  if (error) throw error;
  return (data ?? []).map((r) => r.user_email);
}

export async function touchWatchLastChecked(authorId: string): Promise<void> {
  await supabaseAdmin.from("author_watches").update({ last_checked_at: new Date().toISOString() }).eq("author_id", authorId);
}

// Records one notification per watching user for a newly-found article. Silently no-ops on
// the unique-constraint conflict — re-running the daily check never double-notifies.
export async function insertWatchNotification(data: { user_email: string; author_id: string; article_id: string }): Promise<void> {
  const { error } = await supabaseAdmin
    .from("author_watch_notifications")
    .upsert(data, { onConflict: "user_email,article_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function markWatchNotificationEmailed(id: string): Promise<void> {
  await supabaseAdmin.from("author_watch_notifications").update({ emailed_at: new Date().toISOString() }).eq("id", id);
}

export async function getUserNotifications(userEmail: string, limit = 100): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from("author_watch_notifications")
    .select("id, created_at, read_at, author:authors(id, full_name), article:articles(id, title, url_canonical, published_at)")
    .eq("user_email", userEmail)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function markNotificationRead(id: string, userEmail: string): Promise<void> {
  await supabaseAdmin.from("author_watch_notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_email", userEmail);
}
