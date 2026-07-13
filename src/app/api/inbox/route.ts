import { NextResponse } from "next/server";
import { getInboxList, getSharedSenders } from "@/lib/db/queries";

// GET /api/inbox — everyone we've emailed, grouped, with reply status + sentiment, so the
// inbox can split them into Responses / Awaiting / Filtered (bounces + auto-replies).
export async function GET() {
  const [people, shared] = await Promise.all([getInboxList(), getSharedSenders()]);
  const labelByEmail = new Map(shared.map((s) => [s.email, s.label]));
  const enriched = people.map((p) => ({ ...p, sender_label: p.sender_email ? labelByEmail.get(p.sender_email) ?? null : null }));
  const counts = {
    replied: enriched.filter((p) => p.category === "replied").length,
    sent: enriched.filter((p) => p.category === "sent").length,
    filtered: enriched.filter((p) => p.category === "filtered").length,
  };
  return NextResponse.json({ people: enriched, counts });
}
