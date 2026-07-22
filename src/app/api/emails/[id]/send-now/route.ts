import { NextRequest, NextResponse } from "next/server";
import { getOutreachEmailWithRecipient, updateOutreachEmail, getFollowupParent, addressHasOtherSentInitial } from "@/lib/db/queries";
import { deliverOutreach } from "@/lib/email/deliver";
import { isRoleEmail } from "@/lib/email/roleEmail";
import { acquireLock, releaseLock, incrDailyCount } from "@/lib/redis";

export const maxDuration = 60;

// POST — send ONE queued email immediately, ignoring its scheduled time (the manual
// "Send now" on a queued row). Uses the stamped sender's own Gmail.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Per-email lock so a "Send now" click can't race the cron processor (or a second click)
  // and double-send the same email to the same person.
  const token = `sn-${id}`;
  if (!(await acquireLock(`lock:send:${id}`, 90, token))) {
    return NextResponse.json({ ok: false, error: "This email is already being sent." });
  }
  try {
    const email = await getOutreachEmailWithRecipient(id);
    if (!email) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (email.status === "sent") return NextResponse.json({ ok: true, already: true });
    if (!email.recipient) {
      await updateOutreachEmail(id, { status: "failed", error: "No recipient email address" });
      return NextResponse.json({ ok: false, error: "No recipient email address" });
    }
    if (isRoleEmail(email.recipient)) {
      await updateOutreachEmail(id, { status: "failed", error: "Skipped: generic/role address (not a person)", followup_skipped: true });
      return NextResponse.json({ ok: false, error: "generic/role address — not sent" });
    }
    const isThreadReply = (email as any).kind === "followup" || (email as any).kind === "negotiation";

    // Same send-time duplicate-inbox guard as the cron loop: never send an INITIAL to an inbox
    // that already got an initial from another thread. Not silent — the caller gets a clear
    // reason. Follow-ups / negotiation replies and admin test-sends (recipient_override) are exempt.
    if (!isThreadReply && !(email as any).recipient_override &&
        await addressHasOtherSentInitial(email.recipient, id)) {
      await updateOutreachEmail(id, { status: "failed", error: "Skipped: recipient inbox already contacted in another campaign", followup_skipped: true });
      return NextResponse.json({ ok: false, error: "This inbox was already contacted in another campaign — not sent." });
    }

    let inReplyTo: string | undefined;
    if (isThreadReply && (email as any).parent_id) {
      const parent = await getFollowupParent((email as any).parent_id).catch(() => null);
      // A nudge follow-up is skipped if they've since replied; a negotiation reply is our answer
      // TO their reply, so it always proceeds.
      if ((email as any).kind === "followup" && (parent?.replied_at || parent?.success_at)) {
        await updateOutreachEmail(id, { status: "draft", scheduled_at: null });
        return NextResponse.json({ ok: false, error: "Recipient already replied — follow-up skipped." });
      }
      inReplyTo = parent?.message_id ?? undefined;
    }

    const res = await deliverOutreach({
      to: email.recipient,
      subject: email.subject ?? "(no subject)",
      body: email.body ?? "",
      sender: (email as any).sender_email ?? null,
      sentBy: (email as any).sent_by_email ?? null,
      inReplyTo, references: inReplyTo,
    });

    if (res.ok) {
      await updateOutreachEmail(id, { status: "sent", sent_at: new Date().toISOString(), error: undefined, message_id: res.messageId ?? undefined });
      // Count manual sends toward the sender's daily cap so the cron processor's cap stays honest
      // (manual send is intentional, so we don't hard-block it, but it must still be counted).
      const sender = (email as any).sender_email as string | undefined;
      if (sender) await incrDailyCount(sender, new Date().toISOString().slice(0, 10)).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    await updateOutreachEmail(id, { status: "failed", error: res.error });
    return NextResponse.json({ ok: false, error: res.error });
  } finally {
    await releaseLock(`lock:send:${id}`, token);
  }
}
