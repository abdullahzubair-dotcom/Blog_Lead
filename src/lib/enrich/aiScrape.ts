import { fetchPage } from "@/lib/extract/fetch";
import { isRoleEmail } from "./personFilter";

// Native "AI scrape" — the same idea as ScrapeGraphAI's extract, but done in-house with
// YOUR Claude access (via OPENROUTER_API_KEY) instead of ScrapeGraph's paid credits.
// Fetches a page, strips it to text + mailto links, and asks Claude for the author's email.

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";
const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

export function aiScrapeEnabled(): boolean {
  return !!OPENROUTER_KEY;
}

// Try the likeliest pages for a contact email, in order, until one yields.
// onError fires only on a real failure (missing key / LLM API error), not on "no email".
export async function aiScrapeEmail(name: string, host: string, onError?: (msg: string) => void): Promise<string | null> {
  if (!OPENROUTER_KEY) { onError?.("no OPENROUTER_API_KEY"); return null; }
  if (!host) return null;
  const clean = host.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const pages = [`https://${clean}/contact`, `https://${clean}/about`, `https://${clean}`];
  for (const url of pages) {
    const email = await scrapeOne(name, url, onError);
    if (email) return email;
  }
  return null;
}

async function scrapeOne(name: string, url: string, onError?: (msg: string) => void): Promise<string | null> {
  const fetched = await fetchPage(url).catch(() => null);
  if (!fetched) return null;

  const html = fetched.html;
  const mailtos = [...html.matchAll(/mailto:([^"'>\s?]+)/gi)].map((m) => m[1].toLowerCase());
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 6000);

  const prompt = `You are extracting a contact email from a web page for the writer named "${name}".
mailto links found on the page: ${mailtos.length ? mailtos.join(", ") : "none"}
Page text (truncated): ${text}

Return ONLY that writer's email address if it clearly appears, otherwise return exactly "NONE". No other words.`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4-5",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 30,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) { onError?.(`OpenRouter HTTP ${res.status}`); return null; }
    const data = await res.json();
    const out = (data.choices?.[0]?.message?.content ?? "").trim().toLowerCase().replace(/^mailto:/, "");
    if (!out || out === "none") return null;
    if (!EMAIL_RE.test(out)) return null;
    if (isRoleEmail(out)) return null; // reject generic inboxes (contact@, tips@, info@…)
    return out;
  } catch (e: any) {
    onError?.(e?.name === "TimeoutError" ? "OpenRouter timeout" : (e?.message ?? "OpenRouter network error"));
    return null;
  }
}
