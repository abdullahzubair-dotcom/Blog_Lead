// Slack digest for the daily broken-link audit. The findings list is rendered
// deterministically (links, authors, tags must be exact); Haiku only writes the short
// intro/summary line, with a plain fallback if the AI call fails. Author tagging uses an
// admin-maintained name→Slack-member-ID map (a webhook can't look up user IDs itself).
import { supabaseAdmin } from "@/lib/db/supabase";
import { redis } from "@/lib/redis";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

const WEBHOOK_KEY = "linkaudit:webhook";
const SLACKMAP_KEY = "linkaudit:slackmap";
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

// ─── Digest composition ────────────────────────────────────────────────────────

interface Finding {
  page_url: string; page_author: string | null;
  link_url: string; anchor_text: string | null; context_text: string | null;
  reason: string; http_status: number | null;
}

const REASON_LABEL: Record<string, string> = {
  "http-404": "404", "http-410": "410 gone", "soft-404": "soft 404 (page says not found)", "homepage-redirect": "redirects to homepage",
};

function authorTag(author: string | null, map: Record<string, string>): string {
  if (!author) return "_no author on file_";
  const id = map[author] ?? map[author.toLowerCase()];
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

// Group findings by broken link so a site-wide dead nav link is one entry, not hundreds.
function renderFindings(findings: Finding[], slackMap: Record<string, string>): string {
  const byLink = new Map<string, Finding[]>();
  for (const f of findings) {
    (byLink.get(f.link_url) ?? byLink.set(f.link_url, []).get(f.link_url)!).push(f);
  }
  const groups = [...byLink.entries()].slice(0, MAX_FINDINGS_IN_MESSAGE);
  const lines: string[] = [];
  for (const [link, fs] of groups) {
    const first = fs[0];
    const label = REASON_LABEL[first.reason] ?? first.reason;
    lines.push(`• *Broken:* ${link}  _(${label})_`);
    for (const f of fs.slice(0, 3)) {
      const ctx = (f.context_text ?? "").slice(0, 160);
      lines.push(`   ↳ on <${f.page_url}|${new URL(f.page_url).pathname}> — by ${authorTag(f.page_author, slackMap)}${f.anchor_text ? ` — link text: "${f.anchor_text.slice(0, 60)}"` : ""}`);
      if (ctx && isProseContext(ctx)) lines.push(`      _"…${ctx}…"_`);
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
  const [{ data: run }, { data: findings }, slackMap] = await Promise.all([
    supabaseAdmin.from("link_audit_runs").select("*").eq("id", runId).single(),
    supabaseAdmin.from("link_audit_findings").select("*").eq("run_id", runId).order("link_url"),
    getSlackMap(),
  ]);
  if (!run) return { ok: false, error: "run not found" };

  const fs = (findings ?? []) as Finding[];
  const authors = [...new Set(fs.map((f) => f.page_author).filter(Boolean))] as string[];
  const stats = { pages: run.pages_checked, links: run.links_checked, broken: run.broken_found, authors };

  const intro = (await haikuIntro(stats))
    ?? `Daily link audit for imagine.art: crawled ${stats.pages} pages, checked ${stats.links} links, found ${stats.broken} broken.`;

  let text = `:link: *imagine.art link audit*\n${intro}`;
  if (fs.length > 0) {
    text += `\n\n${renderFindings(fs, slackMap)}`;
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
