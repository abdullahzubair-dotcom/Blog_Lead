import { NextRequest, NextResponse } from "next/server";
import { getInboxTarget, getUserEmailConfig, getUserAppPasswordEnc, resolveInboxAccount, markInboxReplied } from "@/lib/db/queries";
import { supabaseAdmin } from "@/lib/db/supabase";
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
  const account = await resolveInboxAccount(me, req.nextUrl.searchParams.get("as"));

  const target = await getInboxTarget(id, account);
  if (!target) return NextResponse.json({ error: "No conversation with this person in this mailbox." }, { status: 404 });

  // Don't let a human reply collide with the AI negotiator. If this author's thread is AI-managed
  // and still actively negotiating, block the manual send (unless the caller explicitly overrides)
  // and point them to the Negotiation page to take it over there.
  if (!body.overrideAiManaged) {
    const { data: anchor } = await supabaseAdmin.from("outreach_emails")
      .select("ai_managed, negotiation_status").eq("author_id", id).eq("kind", "initial")
      .order("sent_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if ((anchor as any)?.ai_managed && [null, "negotiating"].includes((anchor as any)?.negotiation_status ?? null)) {
      return NextResponse.json({ error: "This thread is being handled by the AI negotiator. Take it over on the Negotiation page (Hand off) before replying here.", aiManaged: true }, { status: 409 });
    }
  }
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

  // Send from the mailbox being viewed (own by default, or the ?as= account for admins).
  const isEnvOwner = !!process.env.SMTP_USER && account.toLowerCase() === process.env.SMTP_USER.toLowerCase();
  const inReplyToFmt = inReplyTo ? (inReplyTo.startsWith("<") ? inReplyTo : `<${inReplyTo}>`) : undefined;

  try {
    const pass = decryptSecret(await getUserAppPasswordEnc(account)) ?? (isEnvOwner ? (process.env.SMTP_PASS ?? null) : null);
    if (!pass) return NextResponse.json({ error: `No Gmail app password on file for ${account}. Add it in Settings to reply from this mailbox.` }, { status: 400 });
    const cfg = await getUserEmailConfig(account);
    const res = await sendEmailAs({ user: account, pass, fromName: cfg.from_name, to: recipient, subject, body: text, inReplyTo: inReplyToFmt, references: inReplyToFmt, attachments });
    if (!res.ok) return NextResponse.json({ error: res.error ?? "Send failed" }, { status: 500 });
    // Record our reply so this thread leaves the "Needs your reply" section.
    await markInboxReplied(account, id).catch(() => {});
    return NextResponse.json({ ok: true, messageId: res.messageId, from: account, to: recipient, subject });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Send failed" }, { status: 500 });
  }
}
