// Hunter.io email finder — takes name + domain directly (unlike Blitz which needs a
// LinkedIn URL). Free tier: 25 finds/month, no credit card. Returns a confidence score
// so we can drop low-quality guesses. Gated by HUNTER_API_KEY.

function key(): string | null {
  return process.env.HUNTER_API_KEY ?? null;
}

export function hunterEnabled(): boolean {
  return !!key();
}

export interface HunterResult {
  email: string;
  score: number; // 0-100 confidence
}

// Returns null on no-key, not-found, rate-limit, or low confidence.
// minScore guards deliverability — only keep emails Hunter is reasonably sure about.
export async function findEmailHunter(fullName: string, domain: string, minScore = 70): Promise<HunterResult | null> {
  const k = key();
  if (!k || !fullName || !domain) return null;

  const params = new URLSearchParams({ domain, full_name: fullName, api_key: k });
  try {
    const res = await fetch(`https://api.hunter.io/v2/email-finder?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) return null; // rate/usage limit — caller should stop trying
    if (!res.ok) return null;
    const data = await res.json();
    const email = data?.data?.email as string | undefined;
    const score = (data?.data?.score as number | undefined) ?? 0;
    if (!email || score < minScore) return null;
    return { email, score };
  } catch {
    return null;
  }
}

// Distinguishes "no email found" from "quota exhausted" so bulk callers can stop early.
export async function hunterStatus(): Promise<{ ok: boolean; used?: number; available?: number }> {
  const k = key();
  if (!k) return { ok: false };
  try {
    const res = await fetch(`https://api.hunter.io/v2/account?api_key=${k}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false };
    const d = await res.json();
    const searches = d?.data?.requests?.searches;
    return { ok: true, used: searches?.used, available: searches?.available };
  } catch {
    return { ok: false };
  }
}
