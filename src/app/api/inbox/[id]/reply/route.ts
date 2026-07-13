import { NextRequest, NextResponse } from "next/server";
import { getInboxTarget, getUserEmailConfig, getUserAppPasswordEnc } from "@/lib/db/queries";
import { decryptSecret } from "@/lib/crypto";
import { sendEmailAs, sendEmail, type MailAttachment } from "@/lib/email/smtp";

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

  const target = await getInboxTarget(id);
  if (!target) return NextResponse.json({ error: "No conversation for this person." }, { status: 404 });
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

  const account = target.senderEmail ?? process.env.SMTP_USER ?? "";
  const inReplyToFmt = inReplyTo ? (inReplyTo.startsWith("<") ? inReplyTo : `<${inReplyTo}>`) : undefined;

  try {
    let res;
    if (target.senderEmail) {
      const pass = decryptSecret(await getUserAppPasswordEnc(target.senderEmail));
      if (!pass) return NextResponse.json({ error: `No app password stored for ${target.senderEmail}.` }, { status: 400 });
      const cfg = await getUserEmailConfig(target.senderEmail);
      res = await sendEmailAs({ user: target.senderEmail, pass, fromName: cfg.from_name, to: recipient, subject, body: text, inReplyTo: inReplyToFmt, references: inReplyToFmt, attachments });
    } else {
      res = await sendEmail({ to: recipient, subject, body: text, inReplyTo: inReplyToFmt, references: inReplyToFmt });
    }
    if (!res.ok) return NextResponse.json({ error: res.error ?? "Send failed" }, { status: 500 });
    return NextResponse.json({ ok: true, messageId: res.messageId, from: account, to: recipient, subject });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Send failed" }, { status: 500 });
  }
}
