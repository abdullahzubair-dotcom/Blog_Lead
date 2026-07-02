// Health checks for every external API key the app depends on. Results are cached
// in-process so polling the banner doesn't hammer upstreams. Only configured keys are
// checked; a configured-but-failing key is what the UI warns about.
import { verifyTransport } from "@/lib/email/smtp";

export interface KeyHealth {
  service: string;
  label: string;
  configured: boolean;
  ok: boolean;
  message: string;
  checkedAt: string;
}

const TTL_MS = 10 * 60 * 1000; // 10 min
const cache = new Map<string, { result: KeyHealth; at: number }>();

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

async function checkHunter(): Promise<KeyHealth> {
  const k = process.env.HUNTER_API_KEY;
  const base = { service: "hunter", label: "Hunter.io (email finder)", checkedAt: new Date().toISOString() };
  if (!k) return { ...base, configured: false, ok: true, message: "Not configured" };
  try {
    const res = await fetch(`https://api.hunter.io/v2/account?api_key=${k}`, { signal: AbortSignal.timeout(8000) });
    if (res.status === 401) return { ...base, configured: true, ok: false, message: "Invalid API key (401)" };
    if (!res.ok) return { ...base, configured: true, ok: false, message: `HTTP ${res.status}` };
    const d = await res.json();
    const s = d?.data?.requests?.searches;
    const left = s ? s.available - s.used : undefined;
    if (left !== undefined && left <= 0) return { ...base, configured: true, ok: false, message: "Monthly search quota exhausted" };
    return { ...base, configured: true, ok: true, message: left !== undefined ? `${left} searches left this month` : "OK" };
  } catch { return { ...base, configured: true, ok: false, message: "Unreachable" }; }
}

async function checkReoon(): Promise<KeyHealth> {
  const k = process.env.REOON_API_KEY;
  const base = { service: "reoon", label: "Reoon (email verifier)", checkedAt: new Date().toISOString() };
  if (!k) return { ...base, configured: false, ok: true, message: "Not configured" };
  try {
    // Quick mode is cheap; an invalid key returns an error payload rather than a verdict.
    const res = await fetch(`https://emailverifier.reoon.com/api/v1/verify?email=health@example.com&key=${k}&mode=quick`, { signal: AbortSignal.timeout(10000) });
    const d = await res.json().catch(() => null);
    // Reoon returns 403 + {status:"error", reason:"Not enough credits..."} when depleted.
    if (d?.status === "error" || !res.ok) {
      const reason = d?.reason ? String(d.reason) : `HTTP ${res.status}`;
      return { ...base, configured: true, ok: false, message: reason };
    }
    if (d?.status === undefined) return { ...base, configured: true, ok: false, message: `HTTP ${res.status}` };
    return { ...base, configured: true, ok: true, message: "OK" };
  } catch { return { ...base, configured: true, ok: false, message: "Unreachable" }; }
}

async function checkBlitz(): Promise<KeyHealth> {
  const k = process.env.BLITZ_API_KEY;
  const base = { service: "blitz", label: "BlitzAPI (LinkedIn enrichment)", checkedAt: new Date().toISOString() };
  if (!k) return { ...base, configured: false, ok: true, message: "Not configured" };
  try {
    const res = await fetch("https://api.blitz-api.ai/v2/account/key-info", { headers: { "x-api-key": k }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ...base, configured: true, ok: false, message: `HTTP ${res.status}` };
    const d = await res.json();
    if (!d?.valid) return { ...base, configured: true, ok: false, message: "Key reported invalid" };
    return { ...base, configured: true, ok: true, message: `OK (${d.remaining_credits} credits)` };
  } catch { return { ...base, configured: true, ok: false, message: "Unreachable" }; }
}

async function checkOpenRouter(): Promise<KeyHealth> {
  const k = process.env.OPENROUTER_API_KEY;
  const base = { service: "openrouter", label: "OpenRouter (AI generation)", checkedAt: new Date().toISOString() };
  if (!k) return { ...base, configured: false, ok: true, message: "Not configured" };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(8000) });
    if (res.status === 401) return { ...base, configured: true, ok: false, message: "Invalid API key (401)" };
    if (!res.ok) return { ...base, configured: true, ok: false, message: `HTTP ${res.status}` };
    return { ...base, configured: true, ok: true, message: "OK" };
  } catch { return { ...base, configured: true, ok: false, message: "Unreachable" }; }
}

async function checkSmtp(): Promise<KeyHealth> {
  const base = { service: "smtp", label: "SMTP (email sending)", checkedAt: new Date().toISOString() };
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { ...base, configured: false, ok: true, message: "Not configured" };
  }
  const v = await withTimeout(verifyTransport(), 10000);
  if (!v) return { ...base, configured: true, ok: false, message: "Verify timed out" };
  return { ...base, configured: true, ok: v.ok, message: v.ok ? "OK" : (v.error ?? "Verify failed") };
}

const CHECKERS: Record<string, () => Promise<KeyHealth>> = {
  smtp: checkSmtp, reoon: checkReoon, hunter: checkHunter, blitz: checkBlitz, openrouter: checkOpenRouter,
};

export async function checkAllKeys(force = false): Promise<KeyHealth[]> {
  const now = Date.now();
  const out: KeyHealth[] = [];
  await Promise.all(Object.entries(CHECKERS).map(async ([svc, fn]) => {
    const cached = cache.get(svc);
    if (!force && cached && now - cached.at < TTL_MS) { out.push(cached.result); return; }
    const result = await fn();
    cache.set(svc, { result, at: now });
    out.push(result);
  }));
  // stable order
  const order = ["smtp", "reoon", "hunter", "blitz", "openrouter"];
  return out.sort((a, b) => order.indexOf(a.service) - order.indexOf(b.service));
}
