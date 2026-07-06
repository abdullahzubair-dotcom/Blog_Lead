import { redis } from "@/lib/redis";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// Tavily has no usage API, so we count calls ourselves (per calendar month) in Redis and
// flag the last hard error. Powers a site-wide banner that warns when you're near/over the
// monthly quota — so you can swap the key before searches start failing.
const LIMIT = Number(process.env.TAVILY_MONTHLY_LIMIT || 1000); // free tier = 1000/mo
const monthKey = () => `tavily:count:${new Date().toISOString().slice(0, 7)}`;
const ERR_KEY = "tavily:error";
const KEY_OVERRIDE_KEY = "tavily:key_override";

// The actual key value used at call time — an admin-set override (changeable from the app,
// no redeploy needed) takes priority over the env var, which remains the "is Tavily wired
// up at all" flag (searchEnabled()/searchProvider() in webSearch.ts stay env-based).
export async function getTavilyKey(): Promise<string | null> {
  const r = redis();
  if (r) {
    const enc = await r.get<string>(KEY_OVERRIDE_KEY).catch(() => null);
    const decrypted = decryptSecret(enc);
    if (decrypted) return decrypted;
  }
  return process.env.TAVILY_API_KEY ?? null;
}

export async function setTavilyKeyOverride(key: string): Promise<void> {
  const r = redis();
  if (!r) throw new Error("Redis not configured — can't store a key override");
  await r.set(KEY_OVERRIDE_KEY, encryptSecret(key));
  await resetTavilyUsage(); // a new/different key starts its own quota — don't carry the old count over
}

export async function clearTavilyKeyOverride(): Promise<void> {
  const r = redis();
  if (!r) return;
  await r.del(KEY_OVERRIDE_KEY);
  await resetTavilyUsage();
}

export async function hasTavilyKeyOverride(): Promise<boolean> {
  const r = redis();
  if (!r) return false;
  return !!(await r.get(KEY_OVERRIDE_KEY).catch(() => null));
}

export async function resetTavilyUsage(): Promise<void> {
  const r = redis();
  if (!r) return;
  await r.del(monthKey()).catch(() => {});
  await r.del(ERR_KEY).catch(() => {});
}

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
