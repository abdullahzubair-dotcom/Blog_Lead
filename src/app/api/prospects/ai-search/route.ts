import { NextRequest, NextResponse } from "next/server";
import { aiProspectSearch } from "@/lib/db/queries";

export const maxDuration = 120;

// POST /api/prospects/ai-search — describe the writers you want in plain English; an LLM pulls
// out search keywords, and we search them across ALL prospects (articles / tool-mentions /
// author / publication). Returns people with an email (guessed optional) not yet contacted
// (unless includeContacted).
//   body: { prompt, includeContacted?, includeGuessed?, limit? }
async function extractKeywords(prompt: string): Promise<string[]> {
  const key = process.env.OPENROUTER_API_KEY;
  const naive = () => [...new Set(prompt.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)))].slice(0, 8);
  if (!key || key.length < 20) return naive();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4-5",
        messages: [{ role: "user", content: `We search a database of writers by the topics/tools/industries their articles cover. Extract search keywords from the request below.

HARD RULES:
- Keep named products/tools/brands EXACTLY as written — NEVER split or reinterpret them. "Seedance" is an AI video tool; do NOT turn it into "dance"/"dance videos". "Midjourney" stays "midjourney", not "journey".
- Only output terms explicitly in the request or unambiguously part of it. Do NOT invent tangential topics (e.g. don't add "viral videos", "social media", "video content" just because a tool makes videos).
- Prefer SPECIFIC named entities (tools, publications, art/media types, industries). Avoid vague generic words that match everything.
- 2 to 6 keywords, lowercase, 1-3 words each, no punctuation.

Return ONLY a JSON array of strings.

Request: "${prompt}"` }],
        max_tokens: 200, temperature: 0.1,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return naive();
    const data = await res.json();
    const txt = data.choices?.[0]?.message?.content ?? "";
    const m = txt.match(/\[[\s\S]*\]/);
    const arr = m ? JSON.parse(m[0]) : [];
    const kws = (Array.isArray(arr) ? arr : []).map((s: any) => String(s).trim()).filter(Boolean);
    return kws.length ? kws.slice(0, 8) : naive();
  } catch { return naive(); }
}
const STOP = new Set(["that", "they", "them", "with", "have", "want", "type", "kind", "list", "people", "author", "authors", "writer", "writers", "written", "about", "which", "from", "these", "those", "their", "would", "there", "email", "emails"]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const prompt = (body.prompt ?? "").toString().trim();
  if (!prompt) return NextResponse.json({ error: "Describe the writers you're looking for." }, { status: 400 });
  try {
    const keywords = await extractKeywords(prompt);
    const { prospects, total, matchedAuthors } = await aiProspectSearch({
      keywords,
      includeContacted: body.includeContacted === true,
      includeGuessed: body.includeGuessed === true,
      limit: Math.min(1000, parseInt(body.limit, 10) || 500), // return lots by default
    });
    return NextResponse.json({ keywords, prospects, total, matchedAuthors });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "search failed" }, { status: 500 });
  }
}
