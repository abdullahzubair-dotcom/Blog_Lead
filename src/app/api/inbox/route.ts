import { NextResponse } from "next/server";
import { getInboxList, getSharedSenders } from "@/lib/db/queries";
import { auth } from "@auth";

// GET /api/inbox — the logged-in user's OWN mailbox only: people they've emailed from their
// address, grouped into Responses / Awaiting / Filtered. Never shows other users' inboxes.
export async function GET() {
  const session = await auth().catch(() => null);
  const me = session?.user?.email;
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const [people, shared] = await Promise.all([getInboxList(me), getSharedSenders()]);
  const labelByEmail = new Map(shared.map((s) => [s.email, s.label]));
  const enriched = people.map((p) => ({ ...p, sender_label: p.sender_email ? labelByEmail.get(p.sender_email) ?? null : null }));
  const counts = {
    replied: enriched.filter((p) => p.category === "replied").length,
    sent: enriched.filter((p) => p.category === "sent").length,
    filtered: enriched.filter((p) => p.category === "filtered").length,
  };
  return NextResponse.json({ people: enriched, counts });
}
