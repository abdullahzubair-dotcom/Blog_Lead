import { redis } from "@/lib/redis";
import { supabaseAdmin } from "@/lib/db/supabase";
import { fetchAllRows } from "@/lib/db/queries";
import { sendEmail } from "@/lib/email/smtp";

// Daily ops digest: per-person scheduled/sent/reply counts, template richness/usage, and which
// sites the team is targeting. Config (on/off + recipient) lives in Redis so it's editable and
// the midnight cron can be turned off without a deploy.
const CFG_KEY = "digest:daily";
const DEFAULT = { enabled: true, recipient: "zain@imagine.art" };

export interface DigestConfig { enabled: boolean; recipient: string }

export async function getDigestConfig(): Promise<DigestConfig> {
  const r = redis();
  if (!r) return DEFAULT;
  const raw = await r.get<any>(CFG_KEY).catch(() => null);
  if (!raw) return DEFAULT;
  try { const o = typeof raw === "string" ? JSON.parse(raw) : raw; return { enabled: o.enabled !== false, recipient: o.recipient || DEFAULT.recipient }; }
  catch { return DEFAULT; }
}
export async function setDigestConfig(patch: Partial<DigestConfig>): Promise<DigestConfig> {
  const r = redis();
  if (!r) throw new Error("Redis not configured");
  const cur = await getDigestConfig();
  const next = { ...cur, ...patch, recipient: (patch.recipient ?? cur.recipient).trim() };
  await r.set(CFG_KEY, JSON.stringify(next));
  return next;
}

export async function buildDailyDigest(): Promise<{ subject: string; text: string }> {
  const rows = await fetchAllRows<{ sender_email: string | null; status: string; template_id: string | null; body: string | null; replied_at: string | null; success_at: string | null; author_id: string }>(
    "outreach_emails", "sender_email, status, template_id, body, replied_at, success_at, author_id", (q) => q.eq("kind", "initial"),
  );

  // Per-person counts (by the mailbox the outreach sends from).
  const bySender: Record<string, { scheduled: number; sent: number; replied: number; won: number }> = {};
  for (const r of rows) {
    const s = r.sender_email || "(server default)";
    (bySender[s] ??= { scheduled: 0, sent: 0, replied: 0, won: 0 });
    if (r.status === "scheduled") bySender[s].scheduled++;
    if (r.status === "sent") bySender[s].sent++;
    if (r.replied_at) bySender[s].replied++;
    if (r.success_at) bySender[s].won++;
  }

  // Template richness / usability: template-backed vs AI-only, and average body length.
  const withTpl = rows.filter((r) => r.template_id).length;
  const aiOnly = rows.length - withTpl;
  const bodies = rows.map((r) => (r.body ?? "").length).filter((n) => n > 0);
  const avgLen = bodies.length ? Math.round(bodies.reduce((a, b) => a + b, 0) / bodies.length) : 0;
  const thin = bodies.filter((n) => n < 300).length;

  // Website usage: top target sites among the authors we've queued/sent to.
  const authorIds = [...new Set(rows.filter((r) => r.status === "sent" || r.status === "scheduled").map((r) => r.author_id))];
  const hostCount: Record<string, number> = {};
  if (authorIds.length) {
    const authors = await fetchAllRows<{ id: string; primary_domain_id: string | null }>("authors", "id, primary_domain_id", (q) => q.in("id", authorIds.slice(0, 1000)));
    const domIds = [...new Set(authors.map((a) => a.primary_domain_id).filter(Boolean) as string[])];
    const domById: Record<string, string> = {};
    if (domIds.length) {
      const doms = await fetchAllRows<{ id: string; host: string }>("domains", "id, host", (q) => q.in("id", domIds.slice(0, 1000)));
      for (const d of doms) domById[d.id] = d.host;
    }
    const domByAuthor: Record<string, string> = {};
    for (const a of authors) if (a.primary_domain_id && domById[a.primary_domain_id]) domByAuthor[a.id] = domById[a.primary_domain_id];
    for (const r of rows) {
      if (r.status !== "sent" && r.status !== "scheduled") continue;
      const h = domByAuthor[r.author_id];
      if (h) hostCount[h] = (hostCount[h] ?? 0) + 1;
    }
  }
  const topSites = Object.entries(hostCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const totalScheduled = Object.values(bySender).reduce((a, b) => a + b.scheduled, 0);
  const totalSent = Object.values(bySender).reduce((a, b) => a + b.sent, 0);

  const lines: string[] = [];
  lines.push(`Daily outreach digest`);
  lines.push(``);
  lines.push(`Scheduled by person:`);
  const senders = Object.entries(bySender).sort((a, b) => (b[1].scheduled + b[1].sent) - (a[1].scheduled + a[1].sent));
  if (senders.length === 0) lines.push(`  (no outreach yet)`);
  for (const [s, c] of senders) lines.push(`  ${s}: ${c.scheduled} scheduled, ${c.sent} sent, ${c.replied} replies, ${c.won} wins`);
  lines.push(``);
  lines.push(`Email templates and richness:`);
  lines.push(`  ${withTpl} template-backed, ${aiOnly} AI-generated (no template)`);
  lines.push(`  average length ${avgLen} chars${thin ? `, ${thin} look thin (<300 chars)` : ""}`);
  lines.push(``);
  lines.push(`Website usage (top target sites):`);
  if (topSites.length === 0) lines.push(`  (none yet)`);
  for (const [host, n] of topSites) lines.push(`  ${host}: ${n}`);
  lines.push(``);
  lines.push(`Totals: ${totalScheduled} scheduled, ${totalSent} sent.`);

  return { subject: `Outreach digest — ${totalScheduled} scheduled, ${totalSent} sent`, text: lines.join("\n") };
}

export async function sendDailyDigest(force = false): Promise<{ sent: boolean; skipped?: string; recipient?: string; cc?: number; error?: string }> {
  const cfg = await getDigestConfig();
  if (!cfg.enabled && !force) return { sent: false, skipped: "disabled" };
  if (!cfg.recipient) return { sent: false, skipped: "no recipient" };
  const { subject, text } = await buildDailyDigest();
  // CC every team member (all configured website users) so the whole team sees the digest.
  const users = await fetchAllRows<{ user_email: string }>("user_email_config", "user_email").catch(() => []);
  const cc = [...new Set(users.map((u) => (u.user_email ?? "").trim().toLowerCase()).filter((e) => e.includes("@") && e !== cfg.recipient.toLowerCase()))];
  const res = await sendEmail({ to: cfg.recipient, cc: cc.length ? cc.join(", ") : undefined, subject, body: text }).catch((e: any) => ({ ok: false, error: e?.message }));
  return res.ok ? { sent: true, recipient: cfg.recipient, cc: cc.length } : { sent: false, error: (res as any).error, recipient: cfg.recipient, cc: cc.length };
}
