import { NextRequest, NextResponse } from "next/server";
import { getInboxTarget, getUserAppPasswordEnc } from "@/lib/db/queries";
import { decryptSecret } from "@/lib/crypto";
import { fetchConversation } from "@/lib/email/inbox";
import { auth } from "@auth";

export const maxDuration = 60;

// GET /api/inbox/[id] — live IMAP conversation, read ONLY from the logged-in user's own mailbox.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth().catch(() => null);
  const me = session?.user?.email;
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const target = await getInboxTarget(id, me);
  if (!target) return NextResponse.json({ error: "No conversation with this person in your mailbox." }, { status: 404 });

  // Always the logged-in user's own mailbox + credentials — never anyone else's.
  const account = me;
  const isEnvOwner = !!process.env.SMTP_USER && me.toLowerCase() === process.env.SMTP_USER.toLowerCase();
  const pass = decryptSecret(await getUserAppPasswordEnc(me)) ?? (isEnvOwner ? (process.env.SMTP_PASS ?? null) : null);
  if (!account || !pass) {
    return NextResponse.json({ error: `No mailbox credentials on file for ${me}. Add your Gmail app password in Settings to read your inbox.`, target, messages: [] }, { status: 200 });
  }

  try {
    const messages = await fetchConversation(account, pass, target.recipient);
    return NextResponse.json({ target: { ...target, account }, messages });
  } catch (e: any) {
    return NextResponse.json({ error: `Couldn't read the mailbox: ${e?.message ?? "IMAP error"}`, target: { ...target, account }, messages: [] }, { status: 200 });
  }
}
