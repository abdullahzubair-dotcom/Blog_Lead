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
      const { trackTavilyCall, flagTavilyError, getActiveTavilyKey, markTavilyKeyExhausted } = await import("./tavilyUsage");
      // Quota-exhaustion statuses → this key is spent for the month; roll to the next in the pool.
      const QUOTA = new Set([402, 403, 429, 432]);
      // Try successive keys from the pool until one works or we run out (cap attempts so a
      // pool of dead keys can't loop forever).
      for (let attempt = 0; attempt < 8; attempt++) {
        const active = await getActiveTavilyKey();
        if (!active) { onError?.("no Tavily key available (pool empty / all exhausted)"); return []; }
        void trackTavilyCall(); // count toward the monthly-usage banner
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: active.key, query, max_results: count, search_depth: "basic" }),
          signal: sig,
        });
        if (res.ok) {
          const d = await res.json();
          return (d.results ?? []).map((r: any) => ({ url: r.url, title: r.title ?? "", snippet: (r.content ?? "").slice(0, 300) })).filter((h: SearchHit) => h.url?.startsWith("http"));
        }
        if (QUOTA.has(res.status) && active.id) {
          // Pool key hit its quota — mark it exhausted for the month and try the next one.
          await markTavilyKeyExhausted(active.id);
          onError?.(`Tavily key ${active.id} exhausted (HTTP ${res.status}) — rotating to next`);
          continue;
        }
        // Non-quota error (e.g. 401 bad key with no id, 5xx) → surface and stop.
        if ([401, 402, 403, 429, 432].includes(res.status)) void flagTavilyError(`HTTP ${res.status}`);
        fail(res); return [];
      }
      onError?.("Tavily: all keys exhausted");
      return [];
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
