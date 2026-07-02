import { NextRequest, NextResponse } from "next/server";
import { upsertDomain, upsertAuthor, upsertContact, linkAuthorsToCampaign, upsertScore } from "@/lib/db/queries";

function hostFrom(input: string): string {
  const s = input.trim().toLowerCase();
  try {
    if (s.startsWith("http")) return new URL(s).hostname.replace(/^www\./, "");
  } catch { /* fall through */ }
  return s.replace(/^www\./, "").replace(/\/.*$/, "");
}

// POST { full_name, email?, publication?, article_url?, campaign_id? } — manually add a
// prospect (creates author + domain + optional email contact) and link to a campaign.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fullName = (body.full_name ?? "").trim();
    if (!fullName) return NextResponse.json({ error: "full_name is required" }, { status: 400 });

    const email = (body.email ?? "").trim();
    // Derive the publication domain from the explicit field or the email address.
    let host = body.publication ? hostFrom(body.publication) : "";
    if (!host && email.includes("@")) host = email.split("@")[1].toLowerCase();
    if (!host) return NextResponse.json({ error: "publication or email domain is required" }, { status: 400 });

    const domain = await upsertDomain(host, { name: body.publication_name ?? host });
    const author = await upsertAuthor({
      full_name: fullName,
      primary_domain_id: domain.id,
      source: "manual",
      role: "writer",
    });

    if (email && email.includes("@")) {
      await upsertContact({
        author_id: author.id, type: "mailto", value: `mailto:${email}`,
        confidence: 1, source: "manual", verified_syntax: true,
      }).catch(() => {});
    }

    // Seed a minimal score so manual adds surface in sorted prospect lists.
    await upsertScore({ author_id: author.id, composite: 50, relevance: 50, authority: 50, freshness: 50 }).catch(() => {});

    if (body.campaign_id) {
      await linkAuthorsToCampaign(body.campaign_id, [author.id]).catch(() => {});
    }

    return NextResponse.json({ ok: true, author_id: author.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
