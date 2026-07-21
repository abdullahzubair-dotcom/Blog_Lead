import { NextRequest, NextResponse } from "next/server";
import { getDueEmails, updateOutreachEmail, getUserEmailConfig, getUserAppPasswordEnc, getFollowupParent, recipientAlreadyContacted } from "@/lib/db/queries";
import { isRoleEmail } from "@/lib/email/roleEmail";
import { supabaseAdmin } from "@/lib/db/supabase";
import { sendEmail, sendEmailAs } from "@/lib/email/smtp";
import { decryptSecret } from "@/lib/crypto";
import { acquireLock, releaseLock, incrDailyCount, getDailyCount } from "@/lib/redis";
import { auth } from "@auth";

export const maxDuration = 300;

const LOCK_KEY = "lock:emails:process";

// Authorized if: no CRON_SECRET configured (local dev), OR the trigger's Bearer token /
// ?key= matches (Vercel cron AND Upstash QStash both send this), OR a valid app session
// (the manual "process now" button).
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  const session = await auth().catch(() => null);
  return !!session;
}

// Sends any scheduled emails whose time has arrived. Any trigger can call this (Vercel cron
// once/day on Hobby, or Upstash QStash every ~30 min for timezone-accurate delivery). A
// Redis lock ensures overlapping triggers never double-send, and a per-workflow daily
// counter enforces the daily cap durably across serverless instances.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const got = await acquireLock(LOCK_KEY, 290, lockToken);
  if (!got) {
    return NextResponse.json({ skipped: "another send run is in progress" });
  }

  const day = new Date().toISOString().slice(0, 10); // UTC date bucket for the daily cap
  // Per-sender credential + config cache (each email sends from its own user's Gmail).
  const senderCache = new Map<string, { pass: string | null; fromName?: string; cap: number }>();
  const senderInfo = async (email: string) => {
    if (!senderCache.has(email)) {
      const [enc, cfg] = await Promise.all([getUserAppPasswordEnc(email), getUserEmailConfig(email)]);
      senderCache.set(email, { pass: decryptSecret(enc), fromName: cfg.from_name, cap: cfg.daily_cap });
    }
    return senderCache.get(email)!;
  };

  let sent = 0, failed = 0, cappedSkipped = 0;
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  try {
    // Reply detection runs BEFORE the send loop — so a follow-up that's due right now sees the
    // freshest reply status and the send-time guard below can park it if the recipient replied
    // since it was scheduled. (Read-only; failures never block sending.)
    let replies = { accountsChecked: 0, repliesFound: 0, errors: [] as string[] };
    try {
      const { runReplyDetection } = await import("@/lib/email/imap");
      replies = await runReplyDetection();
    } catch (e: any) { replies.errors.push(e?.message ?? "reply detection error"); }

    const due = await getDueEmails(50);

    for (const email of due) {
      if (!email.recipient) {
        await updateOutreachEmail(email.id, { status: "failed", error: "No recipient email address" });
        failed++; results.push({ id: email.id, ok: false, error: "no recipient" });
        continue;
      }

      // Never send to a role/generic org mailbox (press@, info@, git@hf.co, …) — not a person,
      // and shared across many authors. Park it so it stops (and won't follow up).
      if (isRoleEmail(email.recipient)) {
        await updateOutreachEmail(email.id, { status: "failed", error: "Skipped: generic/role address (not a person)", followup_skipped: true });
        results.push({ id: email.id, ok: false, error: "role address" });
        continue;
      }
      // Dedupe by destination: if this exact inbox was already emailed (any author), don't
      // email it again — stops the same address getting hit over and over. ONLY for initial
      // sends; follow-ups and negotiation replies are intentional threaded continuations to a
      // recipient we've deliberately already contacted, so they must not be blocked here.
      const isThreadReply = (email as any).kind === "followup" || (email as any).kind === "negotiation";
      if (!isThreadReply && await recipientAlreadyContacted(email.recipient, email.id).catch(() => false)) {
        await updateOutreachEmail(email.id, { status: "failed", error: "Skipped: this address was already emailed", followup_skipped: true });
        results.push({ id: email.id, ok: false, error: "duplicate recipient" });
        continue;
      }

      const sender = (email as any).sender_email as string | undefined;
      const sentBy = (email as any).sent_by_email as string | undefined;
      // CC whoever actually clicked Send when it went out through a shared inbox, so they
      // see replies and can reply themselves.
      const cc = sentBy && sentBy !== sender ? sentBy : undefined;
      let res;

      // Follow-ups thread into the original: pull the parent's Message-ID for In-Reply-To.
      // Also a last-second guard — if the recipient replied or converted since this follow-up
      // was scheduled, park it instead of nagging someone who already engaged.
      let inReplyTo: string | undefined;
      if (isThreadReply && (email as any).parent_id) {
        const parent = await getFollowupParent((email as any).parent_id).catch(() => null);
        // A NUDGE follow-up must not go out if they've since replied/converted. A NEGOTIATION
        // reply is the opposite — it's our answer TO their reply — so it always proceeds.
        if ((email as any).kind === "followup" && (parent?.replied_at || parent?.success_at)) {
          await updateOutreachEmail(email.id, { status: "draft", scheduled_at: null });
          results.push({ id: email.id, ok: false, error: "parent replied — follow-up skipped" });
          continue;
        }
        inReplyTo = parent?.message_id ?? undefined;
      }

      if (sender) {
        const info = await senderInfo(sender);
        if (!info.pass) {
          await updateOutreachEmail(email.id, { status: "failed", error: `Sender ${sender} has no app password set` });
          failed++; results.push({ id: email.id, ok: false, error: "no app password" });
          continue;
        }
        // Daily cap is per-sender (keyed by their email).
        if ((await getDailyCount(sender, day)) >= info.cap) { cappedSkipped++; continue; }
        res = await sendEmailAs({ user: sender, pass: info.pass, fromName: info.fromName, to: email.recipient, subject: email.subject ?? "(no subject)", body: email.body ?? "", cc, inReplyTo, references: inReplyTo });
      } else {
        // Legacy path — no per-user sender: fall back to the server SMTP identity.
        res = await sendEmail({ to: email.recipient, subject: email.subject ?? "(no subject)", body: email.body ?? "", cc, inReplyTo, references: inReplyTo });
      }

      if (res.ok) {
        // Store the Message-ID so IMAP reply detection can thread replies to this send.
        await updateOutreachEmail(email.id, { status: "sent", sent_at: new Date().toISOString(), error: undefined, message_id: res.messageId ?? undefined });
        await incrDailyCount(sender ?? email.workflow_id, day);
        sent++; results.push({ id: email.id, ok: true });
      } else {
        await updateOutreachEmail(email.id, { status: "failed", error: res.error });
        failed++; results.push({ id: email.id, ok: false, error: res.error });
      }
    }

    // Auto-negotiation — when AI autonomy is ON, every AI-managed thread with a NEW reply we
    // haven't answered yet gets an AI reply generated and SENT now (bounded per run). This is
    // what makes the "let AI handle replies" checkbox actually reply on its own.
    const negotiations = { attempted: 0, sent: 0, drafted: 0, errors: [] as string[] };
    try {
      const { getNegotiationSettings } = await import("@/lib/negotiation/settings");
      const settings = await getNegotiationSettings();
      if (settings.ai_autonomy) {
        const { negotiateThread } = await import("@/lib/negotiation/run");
        const { data: inits } = await supabaseAdmin
          .from("outreach_emails").select("id, negotiation_status")
          .eq("kind", "initial").eq("ai_managed", true).not("replied_at", "is", null).limit(40);
        for (const it of inits ?? []) {
          if (["agreed", "declined"].includes((it as any).negotiation_status)) continue;
          const { data: thr } = await supabaseAdmin
            .from("outreach_emails").select("kind, status, replied_at, reply_kind, sent_at")
            .or(`id.eq.${(it as any).id},parent_id.eq.${(it as any).id}`);
          const rowsT = (thr ?? []) as any[];
          if (rowsT.some((r) => r.reply_kind === "auto")) continue; // autoresponders aren't negotiated
          const latestReply = rowsT.map((r) => r.replied_at).filter(Boolean).sort().pop();
          const lastAnswer = rowsT.filter((r) => r.kind === "negotiation" && r.status === "sent").map((r) => r.sent_at).filter(Boolean).sort().pop();
          if (!latestReply) continue;
          if (lastAnswer && lastAnswer >= latestReply) continue; // their latest reply already answered
          negotiations.attempted++;
          const r = await negotiateThread((it as any).id).catch((e: any) => { negotiations.errors.push(e?.message ?? "negotiate error"); return null; });
          if (r?.sent) negotiations.sent++; else if (r?.ok) negotiations.drafted++;
        }
      }
    } catch (e: any) { negotiations.errors.push(e?.message ?? "auto-negotiation error"); }

    // Auto follow-ups — day-2, no-reply initials get a threaded nudge SCHEDULED (kill-switch
    // respected). They send on a later run when due, threaded into the original.
    let followups = { generated: 0, scheduled: 0, skippedDisabled: false, errors: [] as string[] };
    try {
      const { runFollowups } = await import("@/lib/email/followup");
      followups = await runFollowups();
    } catch (e: any) { followups.errors.push(e?.message ?? "followup error"); }

    return NextResponse.json({ due: due.length, sent, failed, cappedSkipped, replies, negotiations, followups, results });
  } finally {
    await releaseLock(LOCK_KEY, lockToken);
  }
}

// Vercel cron / QStash may issue GET — support both.
export async function GET(req: NextRequest) {
  return POST(req);
}
