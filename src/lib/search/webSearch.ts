// Provider-agnostic web search. Real search APIs (not HTML scraping) so they don't get
// bot-blocked or return junk like DuckDuckGo/Bing do from a server. Uses whichever key is
// configured, in order of preference. All have a genuinely free tier:
//   TAVILY_API_KEY        — 1,000/mo, no card, renews (recommended)
//   GOOGLE_CSE_KEY + _CX  — 100/day, no card, renews (real Google)
//   BRAVE_SEARCH_API_KEY  — 2,000/mo, needs card, renews
//   SERPER_API_KEY        — 2,500 one-time, no card (real Google)

export interface SearchHit { url: string; title: string; snippet: string }

export function searchProvider(): string | null {
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX) return "google";
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if (process.env.SERPER_API_KEY) return "serper";
  return null;
}

export function searchEnabled(): boolean {
  return searchProvider() !== null;
}

export async function webSearch(query: string, count = 8, signal?: AbortSignal, onError?: (msg: string) => void): Promise<SearchHit[]> {
  const provider = searchProvider();
  if (!provider) { onError?.("no search API key configured"); return []; }
  const sig = signal ?? AbortSignal.timeout(12000);
  const fail = (res: Response) => onError?.(`${provider} HTTP ${res.status}`);
  try {
    if (provider === "tavily") {
      const { trackTavilyCall, flagTavilyError, getTavilyKey } = await import("./tavilyUsage");
      void trackTavilyCall(); // count toward the monthly-usage banner
      // An admin-set override (changeable in-app, no redeploy) takes priority over the env var.
      const apiKey = await getTavilyKey();
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query, max_results: count, search_depth: "basic" }),
        signal: sig,
      });
      if (!res.ok) {
        // 401 bad key, 429 rate-limited, 432/402 quota exhausted → surface in the banner.
        if ([401, 402, 403, 429, 432].includes(res.status)) void flagTavilyError(`HTTP ${res.status}`);
        fail(res); return [];
      }
      const d = await res.json();
      return (d.results ?? []).map((r: any) => ({ url: r.url, title: r.title ?? "", snippet: (r.content ?? "").slice(0, 300) })).filter((h: SearchHit) => h.url?.startsWith("http"));
    }

    if (provider === "google") {
      const params = new URLSearchParams({ key: process.env.GOOGLE_CSE_KEY!, cx: process.env.GOOGLE_CSE_CX!, q: query, num: String(Math.min(count, 10)) });
      const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, { signal: sig });
      if (!res.ok) { fail(res); return []; }
      const d = await res.json();
      return (d.items ?? []).map((r: any) => ({ url: r.link, title: r.title ?? "", snippet: (r.snippet ?? "").slice(0, 300) })).filter((h: SearchHit) => h.url?.startsWith("http"));
    }

    if (provider === "brave") {
      const params = new URLSearchParams({ q: query, count: String(Math.min(count, 20)) });
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY! },
        signal: sig,
      });
      if (!res.ok) { fail(res); return []; }
      const d = await res.json();
      return (d.web?.results ?? []).map((r: any) => ({ url: r.url, title: r.title ?? "", snippet: (r.description ?? "").slice(0, 300) })).filter((h: SearchHit) => h.url?.startsWith("http"));
    }

    if (provider === "serper") {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: count }),
        signal: sig,
      });
      if (!res.ok) { fail(res); return []; }
      const d = await res.json();
      return (d.organic ?? []).map((r: any) => ({ url: r.link, title: r.title ?? "", snippet: (r.snippet ?? "").slice(0, 300) })).filter((h: SearchHit) => h.url?.startsWith("http"));
    }

    return [];
  } catch (e: any) {
    onError?.(e?.name === "TimeoutError" ? "search timed out" : (e?.message ?? "search network error"));
    return [];
  }
}
