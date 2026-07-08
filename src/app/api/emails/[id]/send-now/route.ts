import { NextRequest, NextResponse } from "next/server";
import { getOutreachEmailWithRecipient, updateOutreachEmail } from "@/lib/db/queries";
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

  const res = await deliverOutreach({
    to: email.recipient,
    subject: email.subject ?? "(no subject)",
    body: email.body ?? "",
    sender: (email as any).sender_email ?? null,
    sentBy: (email as any).sent_by_email ?? null,
  });

  if (res.ok) {
    await updateOutreachEmail(id, { status: "sent", sent_at: new Date().toISOString(), error: undefined, message_id: res.messageId ?? undefined });
    return NextResponse.json({ ok: true });
  }
  await updateOutreachEmail(id, { status: "failed", error: res.error });
  return NextResponse.json({ ok: false, error: res.error });
}
