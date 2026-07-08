import { NextRequest, NextResponse } from "next/server";
import { getOutreachEmailWithRecipient, updateOutreachEmail, getFollowupParent } from "@/lib/db/queries";
import { deliverOutreach } from "@/lib/email/deliver";

export const maxDuration = 60;

// POST — send ONE queued email immediately, ignoring its scheduled time (the manual
// "Send now" on a queued row). Uses the stamped sender's own Gmail.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const email = await getOutreachEmailWithRecipient(id);
  if (!email) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (email.status === "sent") return NextResponse.json({ ok: true, already: true });
  if (!email.recipient) {
    await updateOutreachEmail(id, { status: "failed", error: "No recipient email address" });
    return NextResponse.json({ ok: false, error: "No recipient email address" });
  }

  // A follow-up threads into its parent; skip if the recipient already engaged.
  let inReplyTo: string | undefined;
  if ((email as any).kind === "followup" && (email as any).parent_id) {
    const parent = await getFollowupParent((email as any).parent_id).catch(() => null);
    if (parent?.replied_at || parent?.success_at) {
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
    return NextResponse.json({ ok: true });
  }
  await updateOutreachEmail(id, { status: "failed", error: res.error });
  return NextResponse.json({ ok: false, error: res.error });
}
