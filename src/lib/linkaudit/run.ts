// Daily broken-link audit for imagine.art. Crawls every page in the sitemap, reads every
// link on every page, and flags links that are dead — hard 404/410s, "soft" 404s (pages
// that return 200 but are really a not-found page), and deep links that now redirect to a
// homepage. Soft-404s are detected per host + first path segment by probing a garbage URL
// with the same shape and comparing signatures (imagine.art itself returns 200 for any
// /blogs/* slug, so this matters even for internal links).
//
// Long-job shape mirrors the discovery pipeline: chunked with a time budget on Vercel,
// state in Redis, auto-continued via QStash, results in Postgres for the /link-audit page,
// and a Slack digest posted when the run completes.
import PQueue from "p-queue";
import { supabaseAdmin } from "@/lib/db/supabase";
import { redis } from "@/lib/redis";
import { qstashPublish, isServerless } from "@/lib/qstash";

const SITEMAP_URL = "https://www.imagine.art/sitemap.xml";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MAX_PAGES = 2000;
const MAX_LINKS_PER_PAGE = 300;
const MAX_PAGES_PER_BROKEN_LINK = 5; // cap finding rows for a link broken site-wide (nav/footer)
const CHUNK_BUDGET_MS = isServerless() ? 210_000 : Infinity;
const LINK_CONCURRENCY = 8;

const STATE_KEY = "linkaudit:state";
const CHECKED_KEY = "linkaudit:checked";
const FP_KEY = "linkaudit:fp";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AuditState {
  runId: string;
  pages: string[];
  index: number;
  authorMap: Record<string, string>; // page path -> author name (harvested from blog cards)
  linksChecked: number;
  broken: number;
  unreachable: number;
  log: string[]; // rolling verbose progress lines for the /link-audit page
  startedAt: number;
  updatedAt: number;
}

const MAX_LOG_LINES = 120;
function pushLog(state: AuditState, line: string) {
  state.log ??= []; // states saved before this field existed
  state.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  if (state.log.length > MAX_LOG_LINES) state.log.splice(0, state.log.length - MAX_LOG_LINES);
}

// verdict: ok | 404 | 410 | soft | home | unreach ; count = pages seen on (for the cap)
interface CheckedMap { [urlKey: string]: { v: string; s?: number; n: number } }

interface Fingerprint { status: number; title: string; h1: string; len: number; usable: boolean }
interface FingerprintMap { [hostPrefix: string]: Fingerprint }

export interface ExtractedLink { url: string; anchor: string; context: string }

// ─── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchRaw(url: string, timeoutMs = 12_000): Promise<{ status: number; finalUrl: string; html: string } | { error: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ct = res.headers.get("content-type") ?? "";
    const html = ct.includes("text") || ct.includes("xml") || ct.includes("json") ? await res.text() : "";
    return { status: res.status, finalUrl: res.url, html };
  } catch (e: any) {
    return { error: e?.message ?? "fetch failed" };
  }
}

// ─── Sitemap ───────────────────────────────────────────────────────────────────

export async function fetchSitemapUrls(sitemapUrl = SITEMAP_URL): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [sitemapUrl];
  while (queue.length > 0 && seen.size < MAX_PAGES) {
    const sm = queue.shift()!;
    const res = await fetchRaw(sm, 20_000);
    if ("error" in res || res.status !== 200) continue;
    const locs = [...res.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    // A sitemap index nests more sitemaps; a urlset lists pages.
    if (/<sitemapindex/i.test(res.html)) queue.push(...locs.slice(0, 50));
    else for (const u of locs) { if (seen.size < MAX_PAGES) seen.add(u); }
  }
  return [...seen];
}

// ─── Link + author extraction ──────────────────────────────────────────────────

const SKIP_HREF = /^(#|mailto:|tel:|javascript:|data:|blob:)/i;

export function extractLinks(html: string, pageUrl: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const seen = new Set<string>();
  const re = /<a\s[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < MAX_LINKS_PER_PAGE) {
    const href = m[1].trim();
    if (!href || SKIP_HREF.test(href)) continue;
    let abs: URL;
    try { abs = new URL(href, pageUrl); } catch { continue; }
    if (!/^https?:$/.test(abs.protocol)) continue;
    abs.hash = "";
    const url = abs.href;
    if (url === pageUrl || seen.has(url)) continue;
    seen.add(url);

    const anchor = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    // Surrounding text: strip tags in a window around the match so the Slack digest can
    // show WHERE on the page the link lives. The slice can split a tag at either edge —
    // trim to the first ">" / last "<" so half-open tags (SVG path data etc.) can't leak
    // into the "text".
    const winStart = Math.max(0, m.index - 400);
    let win = html.slice(winStart, m.index + m[0].length + 400);
    const firstGt = win.indexOf(">");
    if (firstGt !== -1 && firstGt < win.indexOf("<")) win = win.slice(firstGt + 1);
    const lastLt = win.lastIndexOf("<");
    if (lastLt > win.lastIndexOf(">")) win = win.slice(0, lastLt);
    const context = win.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
    out.push({ url, anchor, context });
  }
  return out;
}

// imagine.art's blog cards pair each post's URL with its author (avatar img + name <p>).
// Harvesting every card across the crawl builds a URL→author map for the whole blog —
// more reliable than per-page meta, which these pages don't ship.
export function harvestCardAuthors(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /<a\s[^>]*?href="(\/blogs\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const block = m[2];
    if (!/img[^>]+src="[^"]*author/i.test(block)) continue;
    const ps = [...block.matchAll(/<p[^>]*>([^<]{2,50})<\/p>/g)].map((x) => x[1].trim());
    const name = ps.reverse().find((p) => /^[A-Za-zÀ-ž'’.-]+(\s+[A-Za-zÀ-ž'’.-]+){1,3}$/.test(p));
    if (name) map[m[1].replace(/\/$/, "")] = name;
  }
  return map;
}

// The page's OWN author. imagine.art blog posts don't ship meta authors, but they render
// two reliable byline patterns: an author-bio box (<h3>Name</h3><p>Name is a …</p>) and a
// byline strip whose avatar <img alt="Name"> is followed by a <p>Name</p> with the same
// text. Falls back to standard meta/JSON-LD author for anything else.
export function extractPageAuthor(html: string): string | null {
  const NAME = "[A-Za-zÀ-ž'’.-]+(?:\\s+[A-Za-zÀ-ž'’.-]+){1,3}";
  // Author-bio box: heading followed by a bio that restates the name ("Tooba Siddiqui is a…")
  const bio = html.match(new RegExp(`<h3[^>]*>(${NAME})</h3>\\s*<p[^>]*>\\1\\s+is\\s`, ""));
  if (bio) return bio[1].trim();
  // Byline strip: avatar alt text and the adjacent <p> agree on the name
  const byline = html.match(new RegExp(`<img[^>]+alt="(${NAME})"[^>]*>(?:(?!<img)[\\s\\S]){0,300}?<p[^>]*>\\1</p>`, ""));
  if (byline) return byline[1].trim();
  const meta = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']{2,60})["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']{2,60})["'][^>]+name=["']author["']/i);
  if (meta) return meta[1].trim();
  const ld = html.match(/"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]{2,60})"/);
  return ld ? ld[1].trim() : null;
}

// ─── Smart 404 detection ───────────────────────────────────────────────────────

function titleOf(html: string): string {
  return (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}
function h1Of(html: string): string {
  return (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
const NOT_FOUND_RE = /(^|\W)(404|page not found|not found|page doesn'?t exist|no longer (exists|available)|page (is )?missing)(\W|$)/i;

function fpKeyFor(u: URL): string {
  const seg = u.pathname.split("/").filter(Boolean)[0] ?? "";
  return `${u.hostname}|${seg}`;
}

// Bot-walled platforms serve the same interstitial (login/consent/verification wall) for
// every URL, real or dead — soft-404 detection is impossible without a browser, so a 200
// from these counts as alive. Hard 404s (e.g. a deleted YouTube channel) still register.
const SOCIAL_SKIP = new Set([
  "reddit.com", "instagram.com", "facebook.com", "x.com", "twitter.com", "linkedin.com",
  "tiktok.com", "youtube.com", "threads.net", "discord.com", "discord.gg", "pinterest.com", "medium.com",
]);
function isSocialSkip(host: string): boolean {
  const bare = host.replace(/^www\./, "");
  return SOCIAL_SKIP.has(bare) || [...SOCIAL_SKIP].some((d) => bare.endsWith(`.${d}`));
}

// Probe a garbage URL with the same host + first path segment and record its signature.
// Sites with honest 404s return 404 here; soft-404 sites return their not-found page.
// CRITICAL: some sites catch-all unknown sub-paths by serving the SEGMENT ROOT's own
// content (imagine.art/video/garbage returns the /video page) — there, probe equality
// would flag LIVE pages as dead. So a 200 probe is only "usable" if it differs from the
// segment root; a catch-all echo is marked unusable and 200s under it count as alive.
async function getFingerprint(u: URL, cache: FingerprintMap): Promise<Fingerprint | null> {
  const key = fpKeyFor(u);
  if (cache[key]) return cache[key];
  const seg = u.pathname.split("/").filter(Boolean)[0];
  const probePath = `${seg ? `/${seg}` : ""}/la-probe-${Date.now().toString(36)}-definitely-missing`;
  const res = await fetchRaw(`${u.protocol}//${u.host}${probePath}`, 10_000);
  if ("error" in res) return null;
  const fp: Fingerprint = { status: res.status, title: titleOf(res.html), h1: h1Of(res.html), len: res.html.length, usable: false };
  if (res.status === 200) {
    const root = await fetchRaw(`${u.protocol}//${u.host}${seg ? `/${seg}` : "/"}`, 10_000);
    if (!("error" in root) && root.status === 200) {
      const sameTitle = titleOf(root.html) === fp.title;
      const sameLen = Math.abs(root.html.length - fp.len) / Math.max(root.html.length, fp.len, 1) < 0.05;
      fp.usable = !(sameTitle && sameLen); // probe == root → catch-all echo → unusable
    }
  }
  cache[key] = fp;
  return fp;
}

export interface LinkVerdict { verdict: "ok" | "404" | "410" | "soft" | "home" | "unreach"; status?: number }

export async function checkLink(url: string, fpCache: FingerprintMap): Promise<LinkVerdict> {
  let u: URL;
  try { u = new URL(url); } catch { return { verdict: "unreach" }; }

  const res = await fetchRaw(url);
  if ("error" in res) return { verdict: "unreach" };
  if (res.status === 404) return { verdict: "404", status: 404 };
  if (res.status === 410) return { verdict: "410", status: 410 };
  // Bot-blocks, rate limits, server errors: NOT reported as broken (false-positive risk).
  if (res.status !== 200) return { verdict: "unreach", status: res.status };

  // Deep link that now lands on a homepage — dead for citation purposes.
  try {
    const fin = new URL(res.finalUrl);
    const hadPath = u.pathname.replace(/\/$/, "").length > 0;
    const finRoot = fin.pathname.replace(/\/$/, "").length === 0;
    if (hadPath && finRoot) return { verdict: "home", status: 200 };
  } catch { /* keep going */ }

  const title = titleOf(res.html);
  const h1 = h1Of(res.html);
  if (NOT_FOUND_RE.test(title) || NOT_FOUND_RE.test(h1)) return { verdict: "soft", status: 200 };

  // Bot-walled platforms: a 200 can't be inspected further — count as alive.
  if (isSocialSkip(u.hostname)) return { verdict: "ok", status: 200 };

  // Fingerprint comparison for soft-404 domains — only when the probe produced a genuine
  // distinct not-found page (usable), never against a catch-all echo of a live page.
  const fp = await getFingerprint(u, fpCache);
  if (fp && fp.status === 200 && fp.usable) {
    if (title && title === fp.title) return { verdict: "soft", status: 200 };
    if (!title && !fp.title) {
      if (h1 && h1 === fp.h1) return { verdict: "soft", status: 200 };
      // Both signatures empty (JS-shell pages): only a near-byte-identical match to the
      // known not-found page is damning enough — 2%, not 10%.
      if (!h1 && !fp.h1 && Math.abs(res.html.length - fp.len) / Math.max(res.html.length, fp.len, 1) < 0.02) {
        return { verdict: "soft", status: 200 };
      }
    }
  }
  return { verdict: "ok", status: 200 };
}

// ─── Redis state ───────────────────────────────────────────────────────────────

export async function getAuditState(): Promise<AuditState | null> {
  const r = redis();
  if (!r) return null;
  const raw = await r.get<any>(STATE_KEY).catch(() => null);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}
async function saveState(s: AuditState): Promise<void> {
  const r = redis();
  if (!r) return;
  s.updatedAt = Date.now();
  await r.set(STATE_KEY, JSON.stringify(s), { ex: 60 * 60 * 24 }).catch(() => {});
}
export async function clearAuditState(): Promise<void> {
  const r = redis();
  if (!r) return;
  await r.del(STATE_KEY).catch(() => {});
  await r.del(CHECKED_KEY).catch(() => {});
  await r.del(FP_KEY).catch(() => {});
}
async function loadChecked(): Promise<CheckedMap> {
  const r = redis();
  if (!r) return {};
  const raw = await r.get<any>(CHECKED_KEY).catch(() => null);
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
}
async function saveChecked(m: CheckedMap): Promise<void> {
  const r = redis();
  if (!r) return;
  await r.set(CHECKED_KEY, JSON.stringify(m), { ex: 60 * 60 * 24 }).catch(() => {});
}
async function loadFp(): Promise<FingerprintMap> {
  const r = redis();
  if (!r) return {};
  const raw = await r.get<any>(FP_KEY).catch(() => null);
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
}
async function saveFp(m: FingerprintMap): Promise<void> {
  const r = redis();
  if (!r) return;
  await r.set(FP_KEY, JSON.stringify(m), { ex: 60 * 60 * 24 }).catch(() => {});
}

// ─── Runner ────────────────────────────────────────────────────────────────────

const VERDICT_REASON: Record<string, string> = { "404": "http-404", "410": "http-410", soft: "soft-404", home: "homepage-redirect" };

export async function startAudit(): Promise<{ runId: string; pagesTotal: number }> {
  const pages = await fetchSitemapUrls();
  const { data: run, error } = await supabaseAdmin
    .from("link_audit_runs")
    .insert({ status: "running", pages_total: pages.length })
    .select()
    .single();
  if (error) throw error;
  await clearAuditState();
  const state: AuditState = {
    runId: run.id, pages, index: 0, authorMap: {},
    linksChecked: 0, broken: 0, unreachable: 0, log: [],
    startedAt: Date.now(), updatedAt: Date.now(),
  };
  pushLog(state, `Sitemap fetched — ${pages.length} pages queued for crawling`);
  await saveState(state);
  return { runId: run.id, pagesTotal: pages.length };
}

// Process pages from state.index until done or the chunk budget runs out. On budget, hands
// off to a fresh invocation via QStash. On completion, resolves authors onto findings,
// finalizes the run row, posts the Slack digest, and clears state.
export async function processAuditChunk(): Promise<void> {
  const state = await getAuditState();
  if (!state) return;
  const deadline = Date.now() + CHUNK_BUDGET_MS;
  const checked = await loadChecked();
  const fpCache = await loadFp();
  // Internal links that are themselves sitemap pages are alive by definition — skip
  // re-checking them (saves hundreds of fetches per run).
  const sitemapSet = new Set(state.pages.map((p) => p.replace(/\/$/, "")));
  const queue = new PQueue({ concurrency: LINK_CONCURRENCY });

  while (state.index < state.pages.length && Date.now() < deadline) {
    const pageUrl = state.pages[state.index];
    const res = await fetchRaw(pageUrl, 15_000);

    if (!("error" in res) && res.status === 200 && res.html) {
      // Card-harvested authors fill gaps; a page's OWN byline is authoritative and must
      // never be overwritten by another page's card, so it's prefixed to mark priority.
      const cards = harvestCardAuthors(res.html);
      for (const [path, name] of Object.entries(cards)) {
        if (!state.authorMap[`!${path}`] && !state.authorMap[path]) state.authorMap[path] = name;
      }
      const ownAuthor = extractPageAuthor(res.html);
      if (ownAuthor) {
        try { state.authorMap[`!${new URL(pageUrl).pathname.replace(/\/$/, "")}`] = ownAuthor; } catch { /* ignore */ }
      }

      const links = extractLinks(res.html, pageUrl);
      const findings: Array<{ link: ExtractedLink; verdict: LinkVerdict }> = [];

      await Promise.all(links.map((link) => queue.add(async () => {
        if (sitemapSet.has(link.url.replace(/\/$/, ""))) return; // known-live sitemap page
        const prior = checked[link.url];
        if (prior) {
          prior.n++;
          if (VERDICT_REASON[prior.v] && prior.n <= MAX_PAGES_PER_BROKEN_LINK) {
            findings.push({ link, verdict: { verdict: prior.v as LinkVerdict["verdict"], status: prior.s } });
          }
          return;
        }
        const v = await checkLink(link.url, fpCache);
        checked[link.url] = { v: v.verdict, s: v.status, n: 1 };
        state.linksChecked++;
        if (VERDICT_REASON[v.verdict]) { state.broken++; findings.push({ link, verdict: v }); }
        else if (v.verdict === "unreach") state.unreachable++;
      })));
      await queue.onIdle();

      if (findings.length > 0) {
        await supabaseAdmin.from("link_audit_findings").upsert(
          findings.map((f) => ({
            run_id: state.runId, page_url: pageUrl,
            link_url: f.link.url, anchor_text: f.link.anchor, context_text: f.link.context,
            reason: VERDICT_REASON[f.verdict.verdict], http_status: f.verdict.status ?? null,
          })),
          { onConflict: "run_id,page_url,link_url", ignoreDuplicates: true },
        );
      }

      const path = (() => { try { return new URL(pageUrl).pathname || "/"; } catch { return pageUrl; } })();
      const authorNote = ownAuthor ? ` · author: ${ownAuthor}` : "";
      const brokenNote = findings.length > 0 ? ` · ⚠ ${findings.length} BROKEN: ${findings.map((f) => f.link.url).join(", ").slice(0, 160)}` : "";
      pushLog(state, `[${state.index + 1}/${state.pages.length}] ${path} — ${links.length} links${authorNote}${brokenNote}`);
    } else {
      pushLog(state, `[${state.index + 1}/${state.pages.length}] ${pageUrl} — page fetch failed (${"error" in res ? res.error : `HTTP ${res.status}`})`);
    }

    state.index++;
    if (state.index % 5 === 0 || state.index === state.pages.length) {
      await saveState(state);
      await saveChecked(checked);
      await saveFp(fpCache);
      await supabaseAdmin.from("link_audit_runs").update({
        pages_checked: state.index, links_checked: state.linksChecked,
        broken_found: state.broken, unreachable: state.unreachable,
      }).eq("id", state.runId);
    }
  }

  await saveState(state);
  await saveChecked(checked);
  await saveFp(fpCache);

  if (state.index < state.pages.length) {
    // Budget hit with pages remaining → continue in a fresh invocation.
    pushLog(state, `Time budget reached — continuing in a fresh run (${state.pages.length - state.index} pages left)`);
    await saveState(state);
    await qstashPublish("/api/link-audit/run", { continue: true, auto: true });
    return;
  }
  pushLog(state, `Crawl complete — resolving authors and posting the Slack digest…`);
  await saveState(state);

  // ── Finalize ──────────────────────────────────────────────────────────────
  // Resolve authors onto findings now that the card map is complete.
  const { data: rows } = await supabaseAdmin
    .from("link_audit_findings").select("id, page_url").eq("run_id", state.runId);
  for (const row of rows ?? []) {
    try {
      const path = new URL(row.page_url).pathname.replace(/\/$/, "");
      const author = state.authorMap[`!${path}`] ?? state.authorMap[path]; // own byline wins over card data
      if (author) await supabaseAdmin.from("link_audit_findings").update({ page_author: author }).eq("id", row.id);
    } catch { /* ignore */ }
  }

  await supabaseAdmin.from("link_audit_runs").update({
    status: "completed", finished_at: new Date().toISOString(),
    pages_checked: state.index, links_checked: state.linksChecked,
    broken_found: state.broken, unreachable: state.unreachable,
  }).eq("id", state.runId);

  try {
    const { postAuditDigest } = await import("./slack");
    await postAuditDigest(state.runId);
  } catch { /* digest failure shouldn't fail the run */ }

  await clearAuditState();
}
