// Automatic follow-ups: for an initial send that got no reply after N days, generate a
// short, personalized nudge and SCHEDULE it (one per recipient) to send ~a day later AS A
// REPLY IN THE SAME THREAD. Scheduling (rather than firing instantly) gives every follow-up
// a visible date and a window to toggle it off individually. The normal send processor then
// delivers it threaded when due. A global kill-switch and a per-email skip flag are the
// safety valves.
import { redis } from "@/lib/redis";
import { getEmailsNeedingFollowup, createFollowupRow, updateOutreachEmail, FOLLOWUP_LEAD_MS } from "@/lib/db/queries";

const ENABLED_KEY = "followups:enabled";
const FOLLOWUP_DAYS = 2;

export async function followupsEnabled(): Promise<boolean> {
  const r = redis();
  if (!r) return true;
  const v = await r.get(ENABLED_KEY).catch(() => null);
  return v === null || v === undefined ? true : !!v; // default ON (user chose fully-automatic)
}
export async function setFollowupsEnabled(on: boolean): Promise<void> {
  const r = redis();
  if (r) await r.set(ENABLED_KEY, on ? 1 : 0);
}

function sanitize(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ", ").replace(/[ \t]{2,}/g, " ").replace(/ ,/g, ",").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function hasPlaceholder(s: string): boolean { return /\[[^\]]{1,40}\]/.test(s) || /\{\{[^}]+\}\}/.test(s); }

async function generateFollowupBody(authorName: string, pubName: string, originalSubject: string, guidance: string | null): Promise<string> {
  const first = (authorName ?? "there").trim().split(/\s+/)[0] || "there";
  const key = process.env.OPENROUTER_API_KEY;
  const fallback = `Hi ${first},\n\nJust floating this back to the top of your inbox in case it slipped by. Would love to hear your thoughts whenever you get a moment.\n\nBest,\nAbdullah`;
  if (!key || key.length < 20) return fallback;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4-5",
        messages: [{
          role: "user",
          content: `Write a SHORT, warm follow-up email to ${authorName} at ${pubName}. It is a reply in the same thread as a first outreach email (subject was "${originalSubject}") that they haven't replied to after a couple of days.

HARD RULES:
- 2-3 sentences max. Polite, low-pressure, human. Not pushy, not guilt-trippy.
- It's a REPLY in the thread, so don't re-introduce everything; just gently resurface it.
- Start with "Hi ${first},". End with "Best,\\nAbdullah".
- NEVER use bracketed placeholders. NEVER use em-dashes or en-dashes. Plain text only.${guidance ? `\n\nSENDER'S WRITING DIRECTION (obey): ${guidance}` : ""}

Output ONLY the email body.`,
        }],
        max_tokens: 200, temperature: 0.7,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const out = sanitize(data.choices?.[0]?.message?.content?.trim() ?? "");
    return !out || hasPlaceholder(out) ? fallback : out;
  } catch { return fallback; }
}

export interface FollowupResult { generated: number; scheduled: number; skippedDisabled: boolean; errors: string[] }

// Generate + SCHEDULE follow-ups (does not send). One per recipient (createFollowupRow's
// parent already guarantees no duplicate). Handles the backlog too: any initial >2 days old
// with no reply/win and no follow-up yet gets one scheduled ~a day out.
export async function runFollowups(): Promise<FollowupResult> {
  const result: FollowupResult = { generated: 0, scheduled: 0, skippedDisabled: false, errors: [] };
  if (!(await followupsEnabled())) { result.skippedDisabled = true; return result; }

  const candidates = await getEmailsNeedingFollowup(FOLLOWUP_DAYS, 50);
  const when = new Date(Date.now() + FOLLOWUP_LEAD_MS).toISOString();
  for (const c of candidates) {
    try {
      const body = await generateFollowupBody(c.author_name, c.publication, c.subject, c.guidance);
      const subject = /^re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`;
      await createFollowupRow({
        workflow_id: c.workflow_id, author_id: c.author_id, parent_id: c.id, subject, body,
        sender_email: c.sender_email, sent_by_email: c.sent_by_email,
        status: "scheduled", scheduled_at: when,
      });
      result.generated++; result.scheduled++;
    } catch (e: any) {
      result.errors.push(`${c.recipient}: ${e?.message ?? "followup error"}`);
    }
  }
  return result;
}
