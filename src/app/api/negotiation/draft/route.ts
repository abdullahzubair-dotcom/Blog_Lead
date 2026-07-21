import { NextRequest, NextResponse } from "next/server";
import { negotiateThread } from "@/lib/negotiation/run";

export const maxDuration = 60;

// POST { emailId, send? } — generate the AI's next negotiation reply for a thread. Autonomy ON
// sends it immediately; OFF (or send:false) saves a draft to approve. Shared logic lives in
// negotiateThread so the send-processor's auto-negotiation loop behaves identically.
export async function POST(req: NextRequest) {
  const { emailId, send } = await req.json().catch(() => ({}));
  if (!emailId) return NextResponse.json({ error: "emailId required" }, { status: 400 });
  try {
    const r = await negotiateThread(emailId, { forceDraft: send === false });
    if (!r.ok) return NextResponse.json({ error: r.error ?? "draft failed" }, { status: r.error === "email not found" ? 404 : 400 });
    return NextResponse.json({
      ok: true, draftId: r.draftId, body: r.body, classification: { intent: r.intent },
      ceiling: r.ceiling, suggestedOffer: r.suggestedOffer, statusHint: r.statusHint,
      autonomy: r.autonomy, persistedAs: r.persistedAs, sent: r.sent, sendError: r.sendError, recipientMissing: r.recipientMissing,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "draft failed" }, { status: 500 });
  }
}
