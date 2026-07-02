import { Redis } from "@upstash/redis";

// Upstash Redis (REST) — durable state that survives across Vercel serverless instances,
// unlike module-level in-memory buffers. Used for: a distributed send-lock (so overlapping
// cron/QStash triggers never double-send), per-config daily-cap counters, and live send
// progress. Gated by env: if unset (e.g. local dev without Upstash), redis() returns null
// and callers fall back to in-memory behavior.
let _redis: Redis | null | undefined;

export function redis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

export function redisEnabled(): boolean {
  return redis() !== null;
}

// ─── Distributed lock ─────────────────────────────────────────────────────────
// Acquire a lock with a TTL (auto-expires so a crashed holder never deadlocks). Returns a
// token to pass to releaseLock, or null if someone else holds it.
export async function acquireLock(key: string, ttlSeconds: number, token: string): Promise<boolean> {
  const r = redis();
  if (!r) return true; // no Redis (local dev) → single instance, treat as acquired
  const res = await r.set(key, token, { nx: true, ex: ttlSeconds });
  return res === "OK";
}

export async function releaseLock(key: string, token: string): Promise<void> {
  const r = redis();
  if (!r) return;
  // Only release if we still own it (compare token), to avoid releasing a lock that already
  // expired and was re-acquired by someone else.
  const lua = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
  await r.eval(lua, [key], [token]).catch(() => {});
}

// ─── Daily-cap counter (per config, per UTC day) ────────────────────────────────
// Returns the new count after incrementing; the key auto-expires after 48h.
export async function incrDailyCount(configId: string, day: string, by = 1): Promise<number> {
  const r = redis();
  if (!r) return 0; // no Redis → cap enforced only by DB counts (caller handles)
  const key = `sendcount:${configId}:${day}`;
  const n = await r.incrby(key, by);
  await r.expire(key, 60 * 60 * 48);
  return n;
}

export async function getDailyCount(configId: string, day: string): Promise<number> {
  const r = redis();
  if (!r) return 0;
  const n = await r.get<number>(`sendcount:${configId}:${day}`);
  return n ?? 0;
}
