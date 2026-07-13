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
  const active = enriched.filter((p) => !p.dismissed); // dismissed excluded from the main tabs
  const counts = {
    unread: active.filter((p) => p.unread).length,
    replied: active.filter((p) => p.category === "replied").length,
    sent: active.filter((p) => p.category === "sent").length,
    filtered: active.filter((p) => p.category === "filtered").length,
    dismissed: enriched.filter((p) => p.dismissed).length,
  };
  return NextResponse.json({ people: enriched, counts });
}
