import { NextRequest, NextResponse } from "next/server";
import { getProspects } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const format = searchParams.get("format") ?? "csv";
  const minScore = searchParams.get("minScore") ? parseFloat(searchParams.get("minScore")!) : undefined;
  const tool = searchParams.get("tool") ?? undefined;
  const archetype = searchParams.get("archetype") ?? undefined;

  const { prospects } = await getProspects({ limit: 2000, offset: 0, minScore, tool, archetype });

  const rows = prospects.map((p) => ({
    name: p.author.full_name,
    role: p.author.role ?? "",
    publication: p.domain?.name ?? p.domain?.host ?? "",
    domain: p.domain?.host ?? "",
    bio: p.author.description ?? p.author.bio ?? "",
    avatar_url: p.author.avatar_url ?? "",
    composite_score: p.score?.composite ?? 0,
    relevance: p.score?.relevance ?? 0,
    freshness: p.score?.freshness ?? 0,
    authority: p.score?.authority ?? 0,
    competitor_overlap: p.score?.competitor_overlap ?? 0,
    contact_confidence: p.score?.contact_confidence ?? 0,
    tools_mentioned: p.mentions.join("; "),
    imagineart_mentioned: p.mentions.some((m) => m.toLowerCase().includes("imagin")) ? "yes" : "no",
    contacts: p.contacts.map((c) => `${c.type}: ${c.value}`).join("; "),
    email: p.contacts.find((c) => c.type === "mailto")?.value?.replace("mailto:", "") ?? "",
    twitter: p.contacts.find((c) => c.type === "twitter")?.value ?? "",
    linkedin: p.contacts.find((c) => c.type === "linkedin")?.value ?? "",
    author_page: p.contacts.find((c) => c.type === "author_page")?.value ?? "",
    article_count: p.articles.length,
    latest_article: p.articles[0]?.url_canonical ?? "",
    latest_article_title: p.articles[0]?.title ?? "",
    source: p.author.source ?? "",
  }));

  if (format === "json") {
    return NextResponse.json(rows, {
      headers: {
        "Content-Disposition": 'attachment; filename="genai-scout-export.json"',
      },
    });
  }

  // CSV
  const headers = Object.keys(rows[0] ?? {});
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => {
        const val = String((r as any)[h] ?? "").replace(/"/g, '""');
        return `"${val}"`;
      }).join(",")
    ),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="genai-scout-export.csv"',
    },
  });
}
