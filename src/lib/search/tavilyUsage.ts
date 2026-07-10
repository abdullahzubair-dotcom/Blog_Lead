import { redis } from "@/lib/redis";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// Tavily has no usage API, so we count calls ourselves (per calendar month) in Redis and
// flag the last hard error. Powers a site-wide banner that warns when you're near/over the
// monthly quota — so you can swap the key before searches start failing.
const LIMIT = Number(process.env.TAVILY_MONTHLY_LIMIT || 1000); // free tier = 1000/mo
const monthTag = () => new Date().toISOString().slice(0, 7); // "2026-07"
const monthKey = () => `tavily:count:${monthTag()}`;
const ERR_KEY = "tavily:error";
const KEY_OVERRIDE_KEY = "tavily:key_override"; // legacy single-key override (still honored)
const POOL_KEY = "tavily:pool";                 // rotating pool of keys

// ─── Rotating key pool ───────────────────────────────────────────────────────────
// A list of Tavily keys you manage in Settings. Searches use the first non-exhausted key;
// when one hits its monthly quota (429/402/432/403) it's flagged exhausted for the current
// month and searches roll to the next. Exhaustion auto-clears when the month rolls over, so
// keys become usable again on quota renewal. Add as many as you want — you never run out.
export interface PoolEntry { id: string; enc: string; label?: string; exhaustedMonth?: string }
export interface PoolKeyStatus { id: string; label: string; masked: string; active: boolean; exhaustedThisMonth: boolean }

async function readPool(): Promise<PoolEntry[]> {
  const r = redis();
  if (!r) return [];
  const raw = await r.get<any>(POOL_KEY).catch(() => null);
  if (!raw) return [];
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return []; }
}
async function writePool(pool: PoolEntry[]): Promise<void> {
  const r = redis();
  if (!r) throw new Error("Redis not configured — can't store Tavily keys");
  await r.set(POOL_KEY, JSON.stringify(pool));
}
function maskKey(k: string): string {
  return k.length <= 10 ? "••••" : `${k.slice(0, 6)}…${k.slice(-4)}`;
}

export async function addTavilyKey(key: string, label?: string): Promise<void> {
  const clean = key.trim();
  if (!clean) throw new Error("empty key");
  const pool = await readPool();
  if (pool.some((e) => decryptSecret(e.enc) === clean)) return; // skip exact duplicate
  pool.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, enc: encryptSecret(clean)!, label: label?.trim() || undefined });
  await writePool(pool);
}
export async function removeTavilyKey(id: string): Promise<void> {
  await writePool((await readPool()).filter((e) => e.id !== id));
}
export async function markTavilyKeyExhausted(id: string): Promise<void> {
  const pool = await readPool();
  const e = pool.find((x) => x.id === id);
  if (e) { e.exhaustedMonth = monthTag(); await writePool(pool); }
}
export async function listTavilyKeys(): Promise<PoolKeyStatus[]> {
  const month = monthTag();
  return (await readPool()).map((e) => {
    const exhausted = e.exhaustedMonth === month;
    return { id: e.id, label: e.label ?? "", masked: maskKey(decryptSecret(e.enc) ?? ""), active: !exhausted, exhaustedThisMonth: exhausted };
  });
}
// The next usable key: first non-exhausted pool entry, else the legacy override, else env.
export async function getActiveTavilyKey(): Promise<{ id: string | null; key: string } | null> {
  const month = monthTag();
  for (const e of await readPool()) {
    if (e.exhaustedMonth === month) continue;
    const key = decryptSecret(e.enc);
    if (key) return { id: e.id, key };
  }
  const r = redis();
  if (r) {
    const legacy = decryptSecret(await r.get<string>(KEY_OVERRIDE_KEY).catch(() => null));
    if (legacy) return { id: null, key: legacy };
  }
  const env = process.env.TAVILY_API_KEY;
  return env ? { id: null, key: env } : null;
}

// Back-compat single-value accessor (used where rotation isn't needed).
export async function getTavilyKey(): Promise<string | null> {
  return (await getActiveTavilyKey())?.key ?? null;
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
  poolTotal: number;   // keys in the rotating pool
  poolActive: number;  // pool keys not exhausted this month
}

export async function getTavilyUsage(): Promise<TavilyUsage> {
  const r = redis();
  const pool = await listTavilyKeys();
  const poolActive = pool.filter((k) => k.active).length;
  // Enabled if the env key is wired OR we have any pool keys. With a pool, quota is spread
  // across many keys, so the single-key "near/over" banner only fires when nothing's left.
  const enabled = !!process.env.TAVILY_API_KEY || pool.length > 0;
  if (!r) return { enabled, used: 0, limit: LIMIT, near: false, over: false, error: null, poolTotal: pool.length, poolActive };
  const used = Number(await r.get(monthKey()).catch(() => 0)) || 0;
  const errRaw = await r.get<any>(ERR_KEY).catch(() => null);
  const error = errRaw ? (typeof errRaw === "string" ? JSON.parse(errRaw) : errRaw) : null;
  // A pool with active keys left means we're NOT actually out, so suppress the scare banner.
  const outOfKeys = pool.length > 0 ? poolActive === 0 : used >= LIMIT;
  return { enabled, used, limit: LIMIT, near: used >= LIMIT * 0.9, over: outOfKeys, error, poolTotal: pool.length, poolActive };
}
