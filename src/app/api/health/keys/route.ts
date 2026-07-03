import { NextRequest, NextResponse } from "next/server";
import { checkAllKeys } from "@/lib/health/keys";
import { getTavilyUsage } from "@/lib/search/tavilyUsage";

// Services excluded from the banner alert (still checked/listed, just not warned about).
const SUPPRESSED = new Set(["reoon", "hunter"]);

// GET /api/health/keys — status of every configured external API key + Tavily usage.
// ?force=1 bypasses the 10-min cache (used by a manual "recheck" button).
export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const [keys, tavily] = await Promise.all([checkAllKeys(force), getTavilyUsage()]);
  const broken = keys.filter((k) => k.configured && !k.ok && !SUPPRESSED.has(k.service));

  // Amber warnings (not hard failures) — e.g. Tavily search quota nearly/fully used.
  const warnings: { label: string; message: string }[] = [];
  if (tavily.enabled && (tavily.near || tavily.over || tavily.error)) {
    warnings.push({
      label: "Tavily search",
      message: tavily.error
        ? `key error (${tavily.error.detail}) — replace TAVILY_API_KEY`
        : tavily.over
          ? `monthly quota used up (${tavily.used}/${tavily.limit}) — replace the key`
          : `nearly out (${tavily.used}/${tavily.limit} this month) — swap the key soon`,
    });
  }

  return NextResponse.json({ keys, broken, warnings, tavily, healthy: broken.length === 0 && warnings.length === 0 });
}
