import { NextRequest, NextResponse } from "next/server";
import { getInboxTarget, getUserEmailConfig, getUserAppPasswordEnc } from "@/lib/db/queries";
import { decryptSecret } from "@/lib/crypto";
import { sendEmailAs, type MailAttachment } from "@/lib/email/smtp";
import { auth } from "@auth";

export const maxDuration = 60;

// POST /api/inbox/[id]/reply — send a reply into the conversation thread, with optional image
// attachments, from the mailbox that owns the thread. Threads via In-Reply-To/References so it
// nests correctly in Gmail.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const text = (body.body ?? "").toString().trim();
  const to = (body.to ?? "").toString().trim();
  let subject = (body.subject ?? "").toString().trim();
  const inReplyTo = body.inReplyTo ? String(body.inReplyTo) : undefined;
  if (!text) return NextResponse.json({ error: "Message body is required." }, { status: 400 });

  const session = await auth().catch(() => null);
  const me = session?.user?.email;
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const target = await getInboxTarget(id, me);
  if (!target) return NextResponse.json({ error: "No conversation with this person in your mailbox." }, { status: 404 });
  const recipient = to || target.recipient;
  if (!subject) subject = /^re:/i.test(target.lastSubject) ? target.lastSubject : `Re: ${target.lastSubject || "our conversation"}`;

  // Normalize attachments: accept data URLs or raw base64.
  const attachments: MailAttachment[] = Array.isArray(body.attachments)
    ? body.attachments.slice(0, 10).map((a: any) => {
        const raw = String(a.content ?? "");
        const m = raw.match(/^data:([^;]+);base64,(.*)$/);
        return { filename: a.filename || "attachment", content: m ? m[2] : raw.replace(/^data:.*?base64,/, ""), encoding: "base64", contentType: a.contentType || (m ? m[1] : undefined) };
      }).filter((a: MailAttachment) => a.content)
    : [];

  // Always send from the logged-in user's OWN mailbox.
  const isEnvOwner = !!process.env.SMTP_USER && me.toLowerCase() === process.env.SMTP_USER.toLowerCase();
  const inReplyToFmt = inReplyTo ? (inReplyTo.startsWith("<") ? inReplyTo : `<${inReplyTo}>`) : undefined;

  try {
    const pass = decryptSecret(await getUserAppPasswordEnc(me)) ?? (isEnvOwner ? (process.env.SMTP_PASS ?? null) : null);
    if (!pass) return NextResponse.json({ error: `No Gmail app password on file for ${me}. Add it in Settings to reply from your mailbox.` }, { status: 400 });
    const cfg = await getUserEmailConfig(me);
    const res = await sendEmailAs({ user: me, pass, fromName: cfg.from_name, to: recipient, subject, body: text, inReplyTo: inReplyToFmt, references: inReplyToFmt, attachments });
    if (!res.ok) return NextResponse.json({ error: res.error ?? "Send failed" }, { status: 500 });
    return NextResponse.json({ ok: true, messageId: res.messageId, from: me, to: recipient, subject });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Send failed" }, { status: 500 });
  }
}
