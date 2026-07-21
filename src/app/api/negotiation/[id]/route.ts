import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";
import { getConversation } from "@/lib/db/queries";
import { deliverOutreach } from "@/lib/email/deliver";

export const maxDuration = 60;

// GET /api/negotiation/[id] — the full conversation for a thread anchor + its current AI draft
// (the latest kind='negotiation' row), so the Negotiation page can show and let you read it.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const [conversation, { data: draftRow }] = await Promise.all([
      getConversation(id),
      supabaseAdmin.from("outreach_emails")
        .select("id, body, status, subject, created_at").eq("parent_id", id).eq("kind", "negotiation")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return NextResponse.json({ conversation, draft: draftRow ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// POST /api/negotiation/[id] { action: 'send' | 'discard', body? } — send the current draft
// (optionally an edited body) into the thread, or discard it. Threads via the parent Message-ID.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { action, body: editedBody } = await req.json().catch(() => ({}));
    const { data: draft } = await supabaseAdmin.from("outreach_emails")
      .select("id, body, subject, sender_email, sent_by_email, author_id")
      .eq("parent_id", id).eq("kind", "negotiation").in("status", ["draft", "failed"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!draft) return NextResponse.json({ error: "No draft to act on" }, { status: 404 });

    if (action === "discard") {
      await supabaseAdmin.from("outreach_emails").delete().eq("id", (draft as any).id);
      return NextResponse.json({ ok: true, discarded: true });
    }
    if (action !== "send") return NextResponse.json({ error: "bad action" }, { status: 400 });

    const bodyToSend = typeof editedBody === "string" && editedBody.trim() ? editedBody.trim() : (draft as any).body;
    const { data: mc } = await supabaseAdmin.from("contacts").select("value").eq("author_id", (draft as any).author_id).eq("type", "mailto").limit(1).maybeSingle();
    const recipient = ((mc as any)?.value ?? "").replace(/^mailto:/i, "").trim();
    if (!recipient) return NextResponse.json({ error: "No recipient email on file for this author" }, { status: 400 });
    const { data: parent } = await supabaseAdmin.from("outreach_emails").select("message_id").eq("id", id).maybeSingle();
    const parentMsgId = (parent as any)?.message_id ?? undefined;

    const res = await deliverOutreach({
      to: recipient, subject: (draft as any).subject ?? "(no subject)", body: bodyToSend,
      sender: (draft as any).sender_email, sentBy: (draft as any).sent_by_email,
      inReplyTo: parentMsgId, references: parentMsgId,
    });
    if (!res.ok) {
      await supabaseAdmin.from("outreach_emails").update({ status: "failed", error: res.error, body: bodyToSend }).eq("id", (draft as any).id);
      return NextResponse.json({ error: res.error ?? "send failed" }, { status: 500 });
    }
    await supabaseAdmin.from("outreach_emails").update({ status: "sent", sent_at: new Date().toISOString(), message_id: res.messageId ?? null, error: null, body: bodyToSend }).eq("id", (draft as any).id);
    return NextResponse.json({ ok: true, sent: true, to: recipient });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}
