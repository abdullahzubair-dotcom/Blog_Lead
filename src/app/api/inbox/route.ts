import { NextRequest, NextResponse } from "next/server";
import { getInboxList, getSharedSenders, getInboxAccounts, resolveInboxAccount } from "@/lib/db/queries";
import { auth } from "@auth";

// GET /api/inbox — a team mailbox grouped into Responses / Awaiting / Filtered. Defaults to the
// logged-in user's own mailbox; pass ?as=<account> to view another team inbox (admin switcher).
// Also returns the list of accounts to populate that switcher.
export async function GET(req: NextRequest) {
  const session = await auth().catch(() => null);
  const me = session?.user?.email;
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const as = req.nextUrl.searchParams.get("as");
  const viewing = await resolveInboxAccount(me, as);
  const [people, shared, accounts] = await Promise.all([getInboxList(viewing), getSharedSenders(), getInboxAccounts()]);
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
  return NextResponse.json({ people: enriched, counts, accounts, viewing, me });
}
