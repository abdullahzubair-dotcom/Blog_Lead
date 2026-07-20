import { NextRequest, NextResponse } from "next/server";
import { getConversation, markPayment } from "@/lib/db/queries";
import { supabaseAdmin } from "@/lib/db/supabase";
import { deliverOutreach } from "@/lib/email/deliver";

// GET — the full conversation for a payment thread (to read before paying).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ conversation: await getConversation(id) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// POST { action: 'paid' | 'request' | 'reset' } — mark paid, or email the owning account
// (whose email the thread is under, else Abdullah) to process payment; reset back to owed.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { action } = await req.json().catch(() => ({}));
    if (!["paid", "request", "reset"].includes(action)) return NextResponse.json({ error: "bad action" }, { status: 400 });
    await markPayment(id, action);

    if (action === "request") {
      const { data } = await supabaseAdmin
        .from("outreach_emails")
        .select("sender_email, agreed_price, subject, author:authors(full_name, domain:domains(host, name))")
        .eq("id", id).maybeSingle();
      const payer = (data as any)?.sender_email || "abdullah.zubair@imagine.art";
      const name = (data as any)?.author?.full_name ?? "the writer";
      const pub = (data as any)?.author?.domain?.name ?? (data as any)?.author?.domain?.host ?? "";
      const price = (data as any)?.agreed_price;
      const body = `Payment due.\n\nWriter: ${name}\nPublication: ${pub}\nAgreed amount: ${price ?? "?"}\nThread: ${(data as any)?.subject ?? ""}\n\nPlease process this payment, then mark it paid on the Payments page.`;
      await deliverOutreach({ to: payer, subject: `Payment due: ${name}${pub ? " (" + pub + ")" : ""}`, body, sender: payer }).catch(() => {});
      return NextResponse.json({ ok: true, emailedTo: payer });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
