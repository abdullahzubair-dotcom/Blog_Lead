// Content-safety screening via OpenRouter — flags articles for NSFW/sexual content,
// hate/violence/illegal content, or political/religious controversy, so we can avoid
// pitching writers whose work doesn't fit. Mirrors relevance.ts's call shape (same
// model, short timeout, fixed-token reply format, fails open on any API error — a
// classification failure should never block the discovery pipeline).

const MODEL = "anthropic/claude-haiku-4-5";

export type SafetyCategory = "nsfw" | "hate_violence_illegal" | "political_controversy";
export type SafetySeverity = "low" | "medium" | "high";

export interface SafetyResult {
  category: SafetyCategory | null;
  severity: SafetySeverity | null;
  reason?: string;
}

const CLEAN: SafetyResult = { category: null, severity: null };

export async function classifyContentSafety(title: string, text: string, abortSignal?: AbortSignal): Promise<SafetyResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.length < 20) return CLEAN; // no key — fail open, don't block discovery

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://genai-scout.imaginearts.ai",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{
          role: "user",
          content: `You are screening an article for brand-safety reasons before a company decides whether to pitch its author for coverage.

Flag it ONLY if it is a genuine instance of one of these three categories:
1. NSFW — sexual/adult content.
2. HATE_VIOLENCE_ILLEGAL — hate speech, extremism, graphic violence, or promoting illegal activity.
3. POLITICAL_CONTROVERSY — opinionated, hot-button political or religious advocacy (not neutral reporting).

IMPORTANT: an article that merely REPORTS ON, EXPLAINS, or CRITIQUES one of these topics journalistically is NOT the same as advocating or containing it. Do not flag neutral coverage, historical analysis, or policy explainers. Only flag if the article's own content/tone actually falls into one of the categories.

Title: ${title.slice(0, 150)}
Excerpt: ${text.slice(0, 600)}

Reply in this exact format only, nothing else, all on one line:
CATEGORY=NONE SEVERITY=NONE REASON=none
or
CATEGORY=NSFW SEVERITY=HIGH REASON=<why, under 12 words, specific to this article>
(CATEGORY one of: NONE, NSFW, HATE_VIOLENCE_ILLEGAL, POLITICAL_CONTROVERSY. SEVERITY one of: NONE, LOW, MEDIUM, HIGH. REASON is a short human-readable explanation someone could read instead of opening the article.)`,
        }],
        max_tokens: 60,
        temperature: 0,
      }),
      signal: abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });

    if (!res.ok) return CLEAN; // fail open on API error

    const data = await res.json();
    const reply = (data.choices?.[0]?.message?.content ?? "").trim();
    const catMatch = reply.match(/CATEGORY=(NONE|NSFW|HATE_VIOLENCE_ILLEGAL|POLITICAL_CONTROVERSY)/i);
    const sevMatch = reply.match(/SEVERITY=(NONE|LOW|MEDIUM|HIGH)/i);
    const reasonMatch = reply.match(/REASON=(.+)$/i);
    const cat = catMatch?.[1]?.toUpperCase();
    const sev = sevMatch?.[1]?.toUpperCase();
    const reason = reasonMatch?.[1]?.trim().replace(/\.$/, "");

    if (!cat || cat === "NONE" || !sev || sev === "NONE") return CLEAN;
    return {
      category: cat.toLowerCase() as SafetyCategory,
      severity: sev.toLowerCase() as SafetySeverity,
      reason: reason && reason.toLowerCase() !== "none" ? reason : undefined,
    };
  } catch {
    return CLEAN; // network/timeout — fail open, never block the pipeline
  }
}

// Aggregate an author's safety score from their flagged articles. Political-controversy is
// weighted softer than NSFW/hate-violence-illegal given its higher false-positive risk.
export function computeSafetyScore(flags: { category: SafetyCategory; severity: SafetySeverity }[]): number {
  let score = 100;
  for (const f of flags) {
    const weight = f.category === "political_controversy"
      ? { high: 15, medium: 8, low: 3 }[f.severity]
      : { high: 30, medium: 18, low: 8 }[f.severity];
    score -= weight;
  }
  return Math.max(0, Math.min(100, score));
}

const CATEGORY_LABEL: Record<SafetyCategory, string> = {
  nsfw: "NSFW/sexual content",
  hate_violence_illegal: "hate/violence/illegal content",
  political_controversy: "political or religious controversy",
};

// One human-readable sentence explaining an author's score — so you don't have to open
// each flagged article to see why. Returns null when there's nothing to explain (clean).
export function buildSafetySummary(
  score: number,
  flags: { category: SafetyCategory; severity: SafetySeverity; reason?: string | null }[],
): string | null {
  if (flags.length === 0) return null;
  const shown = flags.slice(0, 3).map((f) => {
    const label = CATEGORY_LABEL[f.category] ?? f.category;
    return f.reason ? `${label} (${f.severity}) — ${f.reason}` : `${label} (${f.severity})`;
  });
  const more = flags.length > 3 ? `; and ${flags.length - 3} more` : "";
  const noun = flags.length === 1 ? "post" : "posts";
  return `Score ${score}/100 — ${flags.length} flagged ${noun}: ${shown.join("; ")}${more}.`;
}
