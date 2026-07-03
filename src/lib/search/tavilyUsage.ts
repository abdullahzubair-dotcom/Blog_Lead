import { redis } from "@/lib/redis";

// Tavily has no usage API, so we count calls ourselves (per calendar month) in Redis and
// flag the last hard error. Powers a site-wide banner that warns when you're near/over the
// monthly quota — so you can swap the key before searches start failing.
const LIMIT = Number(process.env.TAVILY_MONTHLY_LIMIT || 1000); // free tier = 1000/mo
const monthKey = () => `tavily:count:${new Date().toISOString().slice(0, 7)}`;
const ERR_KEY = "tavily:error";

export async function trackTavilyCall(): Promise<void> {
  const r = redis();
  if (!r) return;
  const k = monthKey();
  const n = await r.incr(k).catch(() => 0);
  if (n === 1) await r.expire(k, 60 * 60 * 24 * 40).catch(() => {}); // ~40d, spans the month
}

// Flag a hard failure (bad key / quota exceeded / rate limited). Auto-expires in 24h.
export async function flagTavilyError(detail: string): Promise<void> {
  const r = redis();
  if (!r) return;
  await r.set(ERR_KEY, JSON.stringify({ detail, at: Date.now() }), { ex: 60 * 60 * 24 }).catch(() => {});
}

export interface TavilyUsage {
  enabled: boolean;
  used: number;
  limit: number;
  near: boolean;   // >= 90%
  over: boolean;   // >= 100%
  error: { detail: string; at: number } | null;
}

export async function getTavilyUsage(): Promise<TavilyUsage> {
  const enabled = !!process.env.TAVILY_API_KEY;
  const r = redis();
  if (!r) return { enabled, used: 0, limit: LIMIT, near: false, over: false, error: null };
  const used = Number(await r.get(monthKey()).catch(() => 0)) || 0;
  const errRaw = await r.get<any>(ERR_KEY).catch(() => null);
  const error = errRaw ? (typeof errRaw === "string" ? JSON.parse(errRaw) : errRaw) : null;
  return { enabled, used, limit: LIMIT, near: used >= LIMIT * 0.9, over: used >= LIMIT, error };
}
