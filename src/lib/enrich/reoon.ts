// Reoon email verifier (POWER mode) — real SMTP mailbox check + catch-all detection,
// run on Reoon's servers so it works from Vercel (no local port-25 needed).
// Free tier: 600 verifications/month, no credit card. Gated by REOON_API_KEY.

function key(): string | null {
  return process.env.REOON_API_KEY ?? null;
}

export function reoonEnabled(): boolean {
  return !!key();
}

export interface Verdict {
  safe: boolean;       // real, deliverable mailbox
  catchAll: boolean;   // domain accepts everything — a "valid" here is unreliable
  score: number;       // 0-100
  status: string;
}

export async function verifyReoon(email: string, onError?: (msg: string) => void): Promise<Verdict | null> {
  const k = key();
  if (!k) { onError?.("no REOON_API_KEY"); return null; }
  try {
    const params = new URLSearchParams({ email, key: k, mode: "power" });
    const res = await fetch(`https://emailverifier.reoon.com/api/v1/verify?${params}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      // Reoon returns 402/403 with a message when the daily/monthly credits are exhausted.
      let detail = `HTTP ${res.status}`;
      try { const b = await res.json(); if (b?.error || b?.message) detail = String(b.error ?? b.message); } catch { /* ignore */ }
      onError?.(/credit|limit|quota/i.test(detail) ? "out of credits" : detail);
      return null;
    }
    const d = await res.json();
    return {
      safe: d?.status === "safe" || d?.is_safe_to_send === true,
      catchAll: d?.status === "catch_all" || d?.is_catch_all === true,
      score: d?.overall_score ?? 0,
      status: d?.status ?? "unknown",
    };
  } catch (e: any) {
    onError?.(e?.name === "TimeoutError" ? "timeout" : (e?.message ?? "network error"));
    return null;
  }
}
