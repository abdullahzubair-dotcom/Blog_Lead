// Generates diverse search queries via Claude so every discovery run explores new angles.
// Falls back to template queries if the API is unavailable.

import type { SeedTool } from "@/lib/types";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";

async function askClaude(prompt: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4-5",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0.9, // high temp = more varied queries each run
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export async function generateDiscoveryQueries(seeds: SeedTool[], usedQueries: string[] = [], customKeywords?: string[]): Promise<string[]> {
  const competitors = seeds.filter((s) => s.category === "competitor").map((s) => s.name);
  const topics = seeds.filter((s) => s.category === "topic").map((s) => s.name);

  if (!OPENROUTER_KEY) return fallbackQueries(competitors);

  const usedSample = usedQueries.slice(-30).join("\n"); // show Claude recent ones to avoid repeats

  try {
    const toolList = competitors.slice(0, 20).join(", ");
    // Campaign custom keywords take priority over seed topics
    const topicList = customKeywords?.length
      ? customKeywords.join(", ")
      : topics.slice(0, 10).join(", ");

    const raw = await askClaude(`You are helping a generative AI company find editorial writers and bloggers to pitch for coverage.

Generate exactly 30 FRESH, DIVERSE Google/web search queries that would find human-written editorial articles about generative AI tools.
Tools to target: ${toolList}
Topics/Keywords: ${topicList || "generative ai, ai art, ai video, ai image generation, text to image, llm tools"}

Requirements:
- EDITORIAL articles only (reviews, comparisons, roundups, tutorials, "I tested X") — NOT product pages or press releases
- Every query MUST be directly related to the specified Topics/Keywords — stay focused on those themes
- Mix single-tool and multi-tool queries
- Include year-based queries (2024, 2025)
- Include "vs", "alternative to", "review", "best", "top" query patterns
- Include niche angles: specific use-cases, creator workflows, industry verticals
- Each query on its own line, no numbering, no commentary
${usedSample ? `\nAVOID repeating or paraphrasing these already-used queries:\n${usedSample}` : ""}

Output ONLY the 30 queries, one per line.`);

    const lines = raw.split("\n")
      .map((l) => l.trim().replace(/^\d+[\.\)]\s*/, "").replace(/^["']|["']$/g, ""))
      .filter((l) => l.length > 5 && l.length < 120 && !l.startsWith("//") && !l.startsWith("#"));

    const fresh = lines.filter((l) => {
      const norm = l.toLowerCase().trim();
      return !usedQueries.some((u) => u.toLowerCase().trim() === norm);
    });

    if (fresh.length >= 10) return dedupe([...fresh, ...fallbackQueries(competitors)]);
    return fallbackQueries(competitors);
  } catch (e) {
    console.warn("[generateDiscoveryQueries] Claude failed, using fallback:", (e as Error).message);
    return fallbackQueries(competitors);
  }
}

function fallbackQueries(tools: string[]): string[] {
  const base: string[] = [
    "best generative ai tools 2025",
    "ai image generator comparison review",
    "best ai video generator roundup",
    "top ai art tools for creators 2025",
    "generative ai tools for designers",
    "ai image generation tools I tested",
    "best text to image ai 2025",
    "ai video tools comparison 2025",
    "generative ai workflow tutorial",
    "best ai tools for content creators",
  ];
  for (const t of tools.slice(0, 12)) {
    base.push(t, `${t} review`, `${t} vs`, `${t} alternative`, `best ${t} prompts`);
  }
  return dedupe(base);
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.toLowerCase().trim()))].map(
    (s) => s.charAt(0).toUpperCase() + s.slice(1)
  );
}
