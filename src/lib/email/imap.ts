// Read-only reply detection over IMAP. A Gmail app password grants IMAP access (same
// credential used for SMTP sending), so we can log into each sender's mailbox and detect
// which of our outstanding sent emails got an inbound message — then CLASSIFY it, because
// a delivery-failure bounce ("address not found", mailer-daemon) threads back to the
// original send and must NOT be counted as a real reply.
import { ImapFlow } from "imapflow";
import { redis } from "@/lib/redis";
import { decryptSecret } from "@/lib/crypto";
import {
  getUserAppPasswordEnc, getOutstandingSentForReplyCheck, updateOutreachEmail, markRepliesChecked, setAuthorDiscarded,
  stopPendingFollowupsForAuthor,
} from "@/lib/db/queries";

const normId = (s: string) => s.replace(/[<>]/g, "").trim().toLowerCase();
const normSubject = (s: string) => s.replace(/^((re|fw|fwd)\s*:\s*)+/i, "").trim().toLowerCase();

export type ReplyKind = "reply" | "bounce" | "auto";

export interface OutstandingSent {
  id: string;
  author_id: string;
  message_id: string | null;
  recipient: string;
  subject: string;
  sent_at: string;
}

export interface MatchInfo { uid: number; kind: ReplyKind; from: string; subject: string; excerpt: string }

// Decide what an inbound message actually is, from its From address, subject and headers.
export function classify(from: string, subject: string, headers: string): ReplyKind {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();
  const h = headers.toLowerCase();
  const bounce =
    /mailer-?daemon|postmaster|mail delivery (system|subsystem)|maildelivery/.test(f) ||
    /(delivery status notification|undeliverable|mail delivery (failed|subsystem)|delivery has failed|failure notice|returned mail|address not found|could ?n.?t be delivered|delivery incomplete|message (not|could not be) delivered|no such (user|address))/.test(s) ||
    /(x-failed-recipients:|content-type:\s*multipart\/report|report-type=["']?delivery-status|^action:\s*failed|\bstatus:\s*5\.\d\.\d)/m.test(h);
  if (bounce) return "bounce";
  const auto =
    /(auto-submitted:\s*auto-(replied|generated|notified)|x-autoreply:|x-autorespond:|x-auto-response-suppress:|precedence:\s*(auto_reply|bulk|junk))/.test(h) ||
    /(out[ -]of[ -]office|automatic reply|auto-?reply|autoresponder|on vacation|away from (the )?office|annual leave|maternity leave|parental leave|is out of the office)/.test(s);
  if (auto) return "auto";
  return "reply";
}

export function stripToText(raw: string, isHtml: boolean): string {
  let t = raw;
  if (isHtml || /<[a-z][\s\S]*>/i.test(t)) {
    t = t.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
  }
  return t.replace(/\r/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500);
}

// Walk imapflow's bodyStructure to the best text part (prefer text/plain, else text/html).
export function findTextPart(node: any): { part: string | undefined; html: boolean } | null {
  if (!node) return null;
  const type = (node.type || "").toLowerCase();
  if (type === "text/plain") return { part: node.part, html: false };
  if (type === "text/html") return { part: node.part, html: true };
  let htmlHit: { part: string | undefined; html: boolean } | null = null;
  for (const k of node.childNodes || []) {
    const r = findTextPart(k);
    if (r && !r.html) return r;
    if (r && r.html && !htmlHit) htmlHit = r;
  }
  return htmlHit;
}

export async function fetchExcerpt(client: ImapFlow, uid: number, structure: any): Promise<string> {
  const tp = findTextPart(structure);
  const part = tp?.part || "1"; // single-part messages: whole body is part 1
  try {
    const dl = await client.download(uid, part, { uid: true });
    if (!dl?.content) return "";
    const bufs: Buffer[] = [];
    for await (const c of dl.content as AsyncIterable<Buffer>) { bufs.push(c); if (Buffer.concat(bufs).length > 40_000) break; }
    return stripToText(Buffer.concat(bufs).toString("utf8"), !!tp?.html);
  } catch { return ""; }
}

// Connect to one mailbox and return, per outstanding email that got an inbound match, the
// classification + who it was from + subject + a readable excerpt.
export async function detectReplies(user: string, pass: string, outstanding: OutstandingSent[]): Promise<Map<string, MatchInfo>> {
  const matches = new Map<string, MatchInfo>();
  if (outstanding.length === 0) return matches;

  const byMsgId = new Map<string, string>();
  for (const o of outstanding) if (o.message_id) byMsgId.set(normId(o.message_id), o.id);
  const legacy = outstanding.filter((o) => !o.message_id && o.recipient && o.subject);

  const earliest = Math.min(...outstanding.map((o) => new Date(o.sent_at).getTime()));
  const since = new Date(earliest - 24 * 3600_000); // pad a day

  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      let uids = (await client.search({ since }, { uid: true })) || [];
      if (uids.length === 0) return matches;
      if (uids.length > 500) uids = uids.slice(-500);

      const pending = new Map<string, { uid: number; kind: ReplyKind; from: string; subject: string; structure: any }>();
      for await (const msg of client.fetch(
        uids,
        { uid: true, envelope: true, bodyStructure: true, headers: ["in-reply-to", "references", "from", "auto-submitted", "x-autoreply", "x-autorespond", "x-auto-response-suppress", "precedence", "content-type", "x-failed-recipients", "action", "status"] },
        { uid: true },
      )) {
        const hdr = msg.headers?.toString() ?? "";
        const hlow = hdr.toLowerCase();
        const from = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
        const subject = msg.envelope?.subject ?? "";

        // Which of our sends does this inbound message reference?
        let hitId: string | null = null;
        for (const [mid, id] of byMsgId) if (hlow.includes(mid)) { hitId = id; break; }
        if (!hitId && legacy.length > 0) {
          const ns = normSubject(subject);
          for (const o of legacy) if (from && from === o.recipient.toLowerCase() && ns && ns === normSubject(o.subject)) { hitId = o.id; break; }
        }
        if (!hitId) continue;

        const kind = classify(from, subject, hlow);
        const existing = pending.get(hitId);
        // Prefer a genuine reply over a bounce/auto if several inbound messages matched one send.
        if (!existing || (existing.kind !== "reply" && kind === "reply")) {
          pending.set(hitId, { uid: msg.uid!, kind, from, subject, structure: (msg as any).bodyStructure });
        }
      }

      for (const [id, m] of pending) {
        const excerpt = await fetchExcerpt(client, m.uid, m.structure);
        matches.set(id, { uid: m.uid, kind: m.kind, from: m.from, subject: m.subject, excerpt });
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) {
    try { await client.close(); } catch { /* ignore */ }
    throw e;
  }
  return matches;
}

// Rate-limit IMAP per mailbox so the once-a-minute send processor doesn't hammer Gmail.
async function shouldCheck(account: string, minMinutes: number): Promise<boolean> {
  const r = redis();
  if (!r) return true;
  const key = `imap:lastcheck:${account}`;
  const set = await r.set(key, Date.now(), { nx: true, ex: minMinutes * 60 }).catch(() => "OK");
  return set === "OK"; // only the first caller within the window proceeds
}

export interface ReplyDetectionResult { accountsChecked: number; repliesFound: number; bounces: number; autoReplies: number; discarded: number; errors: string[] }

// Sweep every sender mailbox and classify inbound matches. Only genuine human replies set
// replied_at; bounces set bounced_at (and skip follow-ups); auto-replies are recorded but
// counted as neither. `rescanAll` re-examines already-replied sends to fix past mis-counts.
export async function runReplyDetection(opts: { backfillDays?: number; minMinutesBetween?: number; force?: boolean; rescanAll?: boolean } = {}): Promise<ReplyDetectionResult> {
  const backfillDays = opts.backfillDays ?? 30;
  const minMinutes = opts.minMinutesBetween ?? 15;
  const bySender = await getOutstandingSentForReplyCheck(backfillDays, { includeReplied: opts.rescanAll });
  const result: ReplyDetectionResult = { accountsChecked: 0, repliesFound: 0, bounces: 0, autoReplies: 0, discarded: 0, errors: [] };

  const nowIso = new Date().toISOString();
  for (const [sender, list] of bySender) {
    const account = sender || (process.env.SMTP_USER ?? "");
    if (!account) continue;
    if (!opts.force && !(await shouldCheck(account, minMinutes))) continue;

    const pass = sender ? decryptSecret(await getUserAppPasswordEnc(sender)) : (process.env.SMTP_PASS ?? null);
    if (!pass) { result.errors.push(`${account}: no app password`); continue; }

    try {
      result.accountsChecked++;
      const authorById = new Map(list.map((o) => [o.id, o.author_id]));
      const matches = await detectReplies(account, pass, list);
      for (const [id, m] of matches) {
        const meta = { reply_kind: m.kind, reply_from: m.from || null, reply_subject: m.subject || null, reply_excerpt: m.excerpt || null };
        if (m.kind === "reply") {
          // Sentiment of a genuine reply, best-effort (surfaced in the inbox list).
          const { analyzeSentiment } = await import("@/lib/email/inbox");
          const sentiment = await analyzeSentiment(m.excerpt || m.subject).catch(() => null);
          await updateOutreachEmail(id, { ...meta, reply_sentiment: sentiment, replied_at: nowIso, bounced_at: null });
          result.repliesFound++;
          // They replied — immediately stop any follow-up already scheduled to them, so a
          // queued nudge can't land after they've engaged (closes the schedule→reply→send gap).
          const authorId = authorById.get(id);
          if (authorId) await stopPendingFollowupsForAuthor(authorId, "Canceled: recipient replied").catch(() => 0);
        } else if (m.kind === "bounce") {
          // Not a reply — the address bounced. Clear any bogus reply mark, record the bounce,
          // skip follow-ups to a dead address, and discard the author (bad/wrong email) so
          // they drop out of every workflow.
          await updateOutreachEmail(id, { ...meta, replied_at: null, bounced_at: nowIso, followup_skipped: true });
          result.bounces++;
          const authorId = authorById.get(id);
          if (authorId) {
            await stopPendingFollowupsForAuthor(authorId, "Canceled: address bounced").catch(() => 0);
            try { await setAuthorDiscarded(authorId, true); result.discarded++; } catch { /* non-fatal */ }
          }
        } else {
          await updateOutreachEmail(id, { ...meta, replied_at: null });
          result.autoReplies++;
        }
      }
      await markRepliesChecked(list.map((o) => o.id));
    } catch (e: any) {
      result.errors.push(`${account}: ${e?.message ?? "imap error"}`);
    }
  }
  return result;
}
