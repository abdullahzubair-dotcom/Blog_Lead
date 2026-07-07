// Slack digest for the daily broken-link audit. The findings list is rendered
// deterministically (links, authors, tags must be exact); Haiku only writes the short
// intro/summary line, with a plain fallback if the AI call fails. Author tagging uses an
// admin-maintained name→Slack-member-ID map (a webhook can't look up user IDs itself).
import { supabaseAdmin } from "@/lib/db/supabase";
import { redis } from "@/lib/redis";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

const WEBHOOK_KEY = "linkaudit:webhook";
const SLACKMAP_KEY = "linkaudit:slackmap";
const BOT_TOKEN_KEY = "linkaudit:bottoken";
const USERS_CACHE_KEY = "linkaudit:slackusers";
const MAX_FINDINGS_IN_MESSAGE = 25;

// ─── Webhook + author-map storage (webhook stored encrypted, never returned) ──────

export async function getWebhook(): Promise<string | null> {
  const r = redis();
  if (r) {
    const enc = await r.get<string>(WEBHOOK_KEY).catch(() => null);
    const dec = decryptSecret(enc);
    if (dec) return dec;
  }
  return process.env.SLACK_BROKEN_LINKS_WEBHOOK ?? null;
}

export async function setWebhook(url: string): Promise<void> {
  const r = redis();
  if (!r) throw new Error("Redis not configured — can't store the webhook");
  await r.set(WEBHOOK_KEY, encryptSecret(url.trim()));
}

export async function hasWebhook(): Promise<boolean> {
  return !!(await getWebhook());
}

export async function getSlackMap(): Promise<Record<string, string>> {
  const r = redis();
  if (!r) return {};
  const raw = await r.get<any>(SLACKMAP_KEY).catch(() => null);
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
}

export async function setSlackMap(map: Record<string, string>): Promise<void> {
  const r = redis();
  if (!r) throw new Error("Redis not configured");
  await r.set(SLACKMAP_KEY, JSON.stringify(map));
}

// ─── Bot token + workspace user directory (for automatic name→@mention) ──────────
// An incoming webhook can't list users; auto-tagging needs a bot token (xoxb-…, scope
// users:read). Stored encrypted, never returned. Directory cached 12h in Redis.

export async function setBotToken(token: string): Promise<void> {
  const r = redis();
  if (!r) throw new Error("Redis not configured");
  await r.set(BOT_TOKEN_KEY, encryptSecret(token.trim()));
  await r.del(USERS_CACHE_KEY).catch(() => {}); // new token → refetch directory
}

// Roll back a token that failed validation — never leave a broken token wedged in as
// "configured" (everything must keep working token-less until a good one arrives).
export async function clearBotToken(): Promise<void> {
  const r = redis();
  if (!r) return;
  await r.del(BOT_TOKEN_KEY).catch(() => {});
  await r.del(USERS_CACHE_KEY).catch(() => {});
}

export async function hasBotToken(): Promise<boolean> {
  const r = redis();
  if (!r) return false;
  return !!(await r.get(BOT_TOKEN_KEY).catch(() => null));
}

async function getBotToken(): Promise<string | null> {
  const r = redis();
  if (!r) return null;
  return decryptSecret(await r.get<string>(BOT_TOKEN_KEY).catch(() => null));
}

export interface SlackUser { id: string; names: string[] }

export async function fetchSlackUsers(): Promise<SlackUser[]> {
  const r = redis();
  if (r) {
    const cached = await r.get<any>(USERS_CACHE_KEY).catch(() => null);
    if (cached) return typeof cached === "string" ? JSON.parse(cached) : cached;
  }
  const token = await getBotToken();
  if (!token) return [];
  const users: SlackUser[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) { // safety cap: 10 × 200 members
    const params = new URLSearchParams({ limit: "200", ...(cursor ? { cursor } : {}) });
    const res = await fetch(`https://slack.com/api/users.list?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) break;
    const data = await res.json();
    if (!data.ok) break;
    for (const m of data.members ?? []) {
      if (m.deleted || m.is_bot || m.id === "USLACKBOT") continue;
      const names = [m.real_name, m.profile?.real_name, m.profile?.display_name, m.name]
        .filter(Boolean).map((n: string) => n.trim()).filter((n: string) => n.length > 1);
      if (names.length > 0) users.push({ id: m.id, names: [...new Set(names)] });
    }
    cursor = data.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  if (r && users.length > 0) await r.set(USERS_CACHE_KEY, JSON.stringify(users), { ex: 60 * 60 * 12 }).catch(() => {});
  return users;
}

// ─── Fuzzy name matching ──────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// Match a page-author name against the workspace directory. Tiered: exact normalized name →
// all author tokens present in a user's name → small edit distance. Ambiguity (two different
// users matching a tier) returns null — never ping the wrong person.
export function fuzzyMatchUser(author: string, users: SlackUser[]): string | null {
  const a = norm(author);
  if (!a || a.length < 3) return null;
  const aTokens = a.split(" ").filter((t) => t.length > 1);
  const tiers: ((userName: string) => boolean)[] = [
    (n) => n === a,
    (n) => aTokens.length >= 2 && aTokens.every((t) => n.split(" ").some((w) => w === t || w.startsWith(t))),
    (n) => Math.abs(n.length - a.length) <= 3 && editDistance(n, a) <= 2,
  ];
  for (const matches of tiers) {
    const hits = new Set<string>();
    for (const u of users) {
      if (u.names.some((name) => matches(norm(name)))) hits.add(u.id);
    }
    if (hits.size === 1) return [...hits][0];
    if (hits.size > 1) return null; // ambiguous — safer to show the plain name
  }
  return null;
}

// Resolve a set of author names to member IDs: manual map wins, then fuzzy directory match.
export async function resolveAuthorIds(authors: string[]): Promise<Record<string, string>> {
  const map = await getSlackMap();
  const users = await fetchSlackUsers().catch(() => [] as SlackUser[]);
  const out: Record<string, string> = {};
  for (const author of authors) {
    const manual = map[author] ?? map[author.toLowerCase()];
    const id = manual ?? (users.length > 0 ? fuzzyMatchUser(author, users) : null);
    if (id) out[author] = id;
  }
  return out;
}

// ─── Digest composition ────────────────────────────────────────────────────────

interface Finding {
  page_url: string; page_author: string | null;
  link_url: string; anchor_text: string | null; context_text: string | null;
  reason: string; http_status: number | null;
}

const REASON_LABEL: Record<string, string> = {
  "http-404": "404", "http-410": "410 gone", "soft-404": "soft 404 (page says not found)", "homepage-redirect": "redirects to homepage",
};

// `resolved` comes from resolveAuthorIds(): manual map first, then fuzzy directory match.
function authorTag(author: string | null, resolved: Record<string, string>): string {
  if (!author) return "_no author on file_";
  const id = resolved[author];
  return id ? `<@${id}>` : author;
}

// Only quote surrounding text when it reads like prose. Links in navs/footers sit between
// short Titlecase labels ("Privacy Policy Terms & Conditions Help Center Career") — quoting
// that is noise, so those get no quote line; the link text alone identifies them.
function isProseContext(ctx: string): boolean {
  const words = ctx.split(/\s+/).filter(Boolean);
  if (words.length < 8 || ctx.length < 50) return false;
  const capitalized = words.filter((w) => /^[A-Z&|·•>-]/.test(w)).length;
  return capitalized / words.length < 0.5;
}

// Ask Haiku to pinpoint WHERE on the page a link sits, from its anchor + surrounding text —
// "the 'View All' button in the ImagineArt for Teams section" beats a raw text quote,
// especially when the same anchor text ("View All") appears many times on one page.
async function aiLocateFinding(f: Finding): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.length < 20 || !f.context_text) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4-5",
        messages: [{
          role: "user",
          content: `A broken link was found on the page ${new URL(f.page_url).pathname}.
Link text: "${f.anchor_text ?? ""}"
Broken URL: ${f.link_url}
Text surrounding the link on the page: "${f.context_text}"

In ONE short phrase (max 16 words), tell a writer exactly where on the page this link sits, using only details visible in the surrounding text — e.g. "the 'View All' button next to the ImagineArt for Teams category heading" or "the Career link in the footer, after Help Center". Reply with ONLY the phrase. No placeholders, no quotes around the whole phrase.`,
        }],
        max_tokens: 60,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = (data.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
    return out && out.length < 160 && !/\[[^\]]+\]/.test(out) ? out : null;
  } catch {
    return null;
  }
}

// Group findings by broken link so a site-wide dead nav link is one entry, not hundreds.
const MAX_AI_LOCATIONS = 12; // AI-locate the first N groups; the rest fall back to text context
async function renderFindings(findings: Finding[], resolved: Record<string, string>): Promise<string> {
  const byLink = new Map<string, Finding[]>();
  for (const f of findings) {
    (byLink.get(f.link_url) ?? byLink.set(f.link_url, []).get(f.link_url)!).push(f);
  }
  const groups = [...byLink.entries()].slice(0, MAX_FINDINGS_IN_MESSAGE);
  const lines: string[] = [];
  let aiCalls = 0;
  for (const [link, fs] of groups) {
    const first = fs[0];
    const label = REASON_LABEL[first.reason] ?? first.reason;
    lines.push(`• *Broken:* ${link}  _(${label})_`);
    const location = aiCalls < MAX_AI_LOCATIONS ? (aiCalls++, await aiLocateFinding(first)) : null;
    if (location) lines.push(`   📍 ${location}`);
    for (const f of fs.slice(0, 3)) {
      const ctx = (f.context_text ?? "").slice(0, 160);
      lines.push(`   ↳ on <${f.page_url}|${new URL(f.page_url).pathname}> — by ${authorTag(f.page_author, resolved)}${f.anchor_text ? ` — link text: "${f.anchor_text.slice(0, 60)}"` : ""}`);
      if (!location && ctx && isProseContext(ctx)) lines.push(`      _"…${ctx}…"_`);
    }
    if (fs.length > 3) lines.push(`   ↳ …and on ${fs.length - 3} more page${fs.length - 3 === 1 ? "" : "s"}`);
  }
  if (byLink.size > MAX_FINDINGS_IN_MESSAGE) {
    lines.push(`…plus ${byLink.size - MAX_FINDINGS_IN_MESSAGE} more broken links — full list on the Link Audit page.`);
  }
  return lines.join("\n");
}

async function haikuIntro(stats: { pages: number; links: number; broken: number; authors: string[] }): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.length < 20) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4-5",
        messages: [{
          role: "user",
          content: `Write a 1-2 sentence friendly Slack intro for a daily broken-link report on imagine.art. Stats: ${stats.pages} pages crawled, ${stats.links} links checked, ${stats.broken} broken links found${stats.authors.length ? `, affected authors: ${stats.authors.join(", ")}` : ""}. Plain text, no markdown headers, no emojis beyond one at most, no placeholders. Just the intro sentence(s), nothing else.`,
        }],
        max_tokens: 120,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = (data.choices?.[0]?.message?.content ?? "").trim();
    return out && !/\[[^\]]+\]/.test(out) ? out : null;
  } catch {
    return null;
  }
}

export async function postToSlack(text: string): Promise<{ ok: boolean; error?: string }> {
  const webhook = await getWebhook();
  if (!webhook) return { ok: false, error: "No Slack webhook configured" };
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `Slack HTTP ${res.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "post failed" };
  }
}

// Compose + post the digest for a completed run. Posts an "all clean" note when nothing
// broke, so the daily outline always arrives.
export async function postAuditDigest(runId: string): Promise<{ ok: boolean; error?: string }> {
  const [{ data: run }, { data: findings }] = await Promise.all([
    supabaseAdmin.from("link_audit_runs").select("*").eq("id", runId).single(),
    supabaseAdmin.from("link_audit_findings").select("*").eq("run_id", runId).order("link_url"),
  ]);
  if (!run) return { ok: false, error: "run not found" };

  const fs = (findings ?? []) as Finding[];
  const authors = [...new Set(fs.map((f) => f.page_author).filter(Boolean))] as string[];
  // Auto-@: manual map overrides, then fuzzy match against the workspace directory.
  const resolved = await resolveAuthorIds(authors);
  const stats = { pages: run.pages_checked, links: run.links_checked, broken: run.broken_found, authors };

  const intro = (await haikuIntro(stats))
    ?? `Daily link audit for imagine.art: crawled ${stats.pages} pages, checked ${stats.links} links, found ${stats.broken} broken.`;

  let text = `:link: *imagine.art link audit*\n${intro}`;
  if (fs.length > 0) {
    text += `\n\n${await renderFindings(fs, resolved)}`;
  } else {
    text += `\n\nAll clean today — no broken links found. :white_check_mark:`;
  }
  if (run.unreachable > 0) {
    text += `\n\n_${run.unreachable} links couldn't be verified (bot-blocked or timed out) — not counted as broken._`;
  }

  const res = await postToSlack(text.slice(0, 39_000));
  if (res.ok) {
    await supabaseAdmin.from("link_audit_runs").update({ slack_posted_at: new Date().toISOString() }).eq("id", runId);
  }
  return res;
}
