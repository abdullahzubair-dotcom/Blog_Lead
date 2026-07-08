// Read-only reply detection over IMAP. A Gmail app password grants IMAP access (same
// credential used for SMTP sending), so we can log into each sender's mailbox and detect
// which of our outstanding sent emails have received a reply — no OAuth, no new secrets.
import { ImapFlow } from "imapflow";
import { redis } from "@/lib/redis";
import { decryptSecret } from "@/lib/crypto";
import {
  getUserAppPasswordEnc, getOutstandingSentForReplyCheck, markEmailsReplied, markRepliesChecked,
} from "@/lib/db/queries";

const normId = (s: string) => s.replace(/[<>]/g, "").trim().toLowerCase();
const normSubject = (s: string) => s.replace(/^((re|fw|fwd)\s*:\s*)+/i, "").trim().toLowerCase();

export interface OutstandingSent {
  id: string;
  message_id: string | null;
  recipient: string;
  subject: string;
  sent_at: string;
}

// Connect to one mailbox and return the ids of our outstanding emails that got a reply.
// Matches precisely by threading headers (In-Reply-To / References contain our Message-ID),
// with a from+subject fallback for legacy sends that have no stored Message-ID.
export async function detectReplies(user: string, pass: string, outstanding: OutstandingSent[]): Promise<Set<string>> {
  const replied = new Set<string>();
  if (outstanding.length === 0) return replied;

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
      if (uids.length === 0) return replied;
      // Bound work: only the most recent chunk (replies to recent sends are recent).
      if (uids.length > 500) uids = uids.slice(-500);

      for await (const msg of client.fetch(uids, { uid: true, envelope: true, headers: ["in-reply-to", "references"] }, { uid: true })) {
        const hdr = (msg.headers?.toString() ?? "").toLowerCase();
        for (const [mid, id] of byMsgId) if (hdr.includes(mid)) replied.add(id);

        if (legacy.length > 0) {
          const from = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
          const subj = normSubject(msg.envelope?.subject ?? "");
          for (const o of legacy) {
            if (from && from === o.recipient.toLowerCase() && subj && subj === normSubject(o.subject)) replied.add(o.id);
          }
        }
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) {
    try { await client.close(); } catch { /* ignore */ }
    throw e;
  }
  return replied;
}

// Rate-limit IMAP per mailbox so the once-a-minute send processor doesn't hammer Gmail.
async function shouldCheck(account: string, minMinutes: number): Promise<boolean> {
  const r = redis();
  if (!r) return true;
  const key = `imap:lastcheck:${account}`;
  const set = await r.set(key, Date.now(), { nx: true, ex: minMinutes * 60 }).catch(() => "OK");
  return set === "OK"; // only the first caller within the window proceeds
}

export interface ReplyDetectionResult { accountsChecked: number; repliesFound: number; errors: string[] }

// Sweep every sender mailbox with outstanding un-replied sent emails and mark replies.
// senderEmail null (legacy env-sender sends) uses the env SMTP account.
export async function runReplyDetection(opts: { backfillDays?: number; minMinutesBetween?: number; force?: boolean } = {}): Promise<ReplyDetectionResult> {
  const backfillDays = opts.backfillDays ?? 30;
  const minMinutes = opts.minMinutesBetween ?? 15;
  const bySender = await getOutstandingSentForReplyCheck(backfillDays); // Map<senderEmail|"", OutstandingSent[]>
  const result: ReplyDetectionResult = { accountsChecked: 0, repliesFound: 0, errors: [] };

  for (const [sender, list] of bySender) {
    const account = sender || (process.env.SMTP_USER ?? "");
    if (!account) continue;
    if (!opts.force && !(await shouldCheck(account, minMinutes))) continue;

    const pass = sender ? decryptSecret(await getUserAppPasswordEnc(sender)) : (process.env.SMTP_PASS ?? null);
    if (!pass) { result.errors.push(`${account}: no app password`); continue; }

    try {
      result.accountsChecked++;
      const replied = await detectReplies(account, pass, list);
      if (replied.size > 0) { await markEmailsReplied([...replied]); result.repliesFound += replied.size; }
      await markRepliesChecked(list.map((o) => o.id));
    } catch (e: any) {
      result.errors.push(`${account}: ${e?.message ?? "imap error"}`);
    }
  }
  return result;
}
