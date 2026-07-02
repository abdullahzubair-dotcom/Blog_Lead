// GenAI relevance scoring via OpenRouter (uses OPENROUTER_API_KEY which is an OpenRouter key).
// scoreArticleRelevance() returns { relevant, score } where score is 0-100.
// Fails open on any API error so we never silently drop content.

const MODEL = "anthropic/claude-haiku-4-5";

const STRONG_SIGNALS = [
  "midjourney", "dall-e", "dalle", "stable diffusion", "chatgpt", "claude ai", "gemini",
  "openai", "anthropic", "llm", "generative ai", "gen ai", "genai", "ai art", "ai image",
  "text-to-image", "text to image", "diffusion model", "sora", "runway ml", "ideogram",
  "flux model", "ai video", "ai music", "ai writing", "udio", "suno", "pika labs",
  "leonardo ai", "adobe firefly", "gpt-4", "gpt4", "ai tool", "ai tools",
  "imagine.art", "imagineart", "kling ai", "luma ai", "heygen", "invideo",
];

const OFF_TOPIC = [
  "cryptocurrency", "bitcoin", "ethereum", "forex", "real estate listing",
  "recipe", "cooking tutorial", "fitness routine", "travel itinerary",
];

export interface RelevanceResult {
  relevant: boolean;
  score: number; // 0-100
}

export async function scoreArticleRelevance(title: string, snippet: string, abortSignal?: AbortSignal): Promise<RelevanceResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const combined = `${title} ${snippet}`.toLowerCase();

  // Hard off-topic: skip before any API call
  if (OFF_TOPIC.some((s) => combined.includes(s))) return { relevant: false, score: 0 };

  // No API key — fall back to keyword heuristic
  if (!apiKey || apiKey.length < 20) {
    const hits = STRONG_SIGNALS.filter((s) => combined.includes(s)).length;
    const score = Math.min(100, hits * 25 + 10);
    return { relevant: hits > 0, score };
  }

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
          content: `You are scoring articles for a generative AI editorial outreach tool.

Rate this article on two things:
1. RELEVANT (yes/no): Is it a human-written editorial article specifically covering generative AI tools (image generators, text-to-video, LLMs, AI art tools, AI writing assistants, etc.)? NOT product pages, NOT general tech news unrelated to genAI.
2. SCORE (0-100): How valuable is this author for genAI editorial outreach? Consider: covers genAI tools in depth (listicles/reviews/comparisons score higher), writes regularly, genuine editorial voice.

Title: ${title.slice(0, 150)}
Excerpt: ${snippet.slice(0, 400)}

Reply in this exact format only: RELEVANT=YES SCORE=75
Replace YES with NO and adjust score accordingly if not relevant.`,
        }],
        max_tokens: 20,
        temperature: 0,
      }),
      signal: abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      // Fallback to keyword heuristic on API error
      const hits = STRONG_SIGNALS.filter((s) => combined.includes(s)).length;
      return { relevant: hits > 0 || true, score: Math.min(100, hits * 20 + 15) };
    }

    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content ?? "").trim();

    const relMatch = text.match(/RELEVANT=(YES|NO)/i);
    const scoreMatch = text.match(/SCORE=(\d+)/i);

    const relevant = relMatch ? relMatch[1].toUpperCase() === "YES" : true;
    const score = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : 30;

    return { relevant, score };
  } catch {
    // Network/timeout — fail open with a mid-range score
    return { relevant: true, score: 25 };
  }
}
