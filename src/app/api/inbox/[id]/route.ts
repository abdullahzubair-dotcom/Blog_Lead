import { NextRequest, NextResponse } from "next/server";
import { getInboxTarget, getUserAppPasswordEnc } from "@/lib/db/queries";
import { decryptSecret } from "@/lib/crypto";
import { fetchConversation } from "@/lib/email/inbox";

export const maxDuration = 60;

// GET /api/inbox/[id] — live IMAP conversation between our mailbox and this author.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const target = await getInboxTarget(id);
  if (!target) return NextResponse.json({ error: "No conversation for this person yet." }, { status: 404 });

  // The mailbox that holds the thread: the sender we used, else the env SMTP identity.
  const account = target.senderEmail ?? process.env.SMTP_USER ?? "";
  const pass = target.senderEmail ? decryptSecret(await getUserAppPasswordEnc(target.senderEmail)) : (process.env.SMTP_PASS ?? null);
  if (!account || !pass) {
    return NextResponse.json({ error: `No mailbox credentials available for ${account || "the sender"}.`, target, messages: [] }, { status: 200 });
  }

  try {
    const messages = await fetchConversation(account, pass, target.recipient);
    return NextResponse.json({ target: { ...target, account }, messages });
  } catch (e: any) {
    return NextResponse.json({ error: `Couldn't read the mailbox: ${e?.message ?? "IMAP error"}`, target: { ...target, account }, messages: [] }, { status: 200 });
  }
}
