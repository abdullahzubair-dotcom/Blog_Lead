import { verifyReoon } from "./reoon";

export type VerifyStatus = "safe" | "invalid" | "catch_all" | "unknown";
export interface Verdict { status: VerifyStatus }

// Free local verification via SMTP/MX mailbox probe (no API credits). Works when
// outbound port 25 is open (local dev); blocked on most serverless hosts. Cannot
// reliably detect catch-all, so a "safe" here is weaker than Reoon's.
async function verifyLocal(email: string): Promise<Verdict | null> {
  try {
    const mod = await import("deep-email-validator");
    const validate = (mod as any).default ?? mod;
    const r = await validate({ email, validateRegex: true, validateMx: true, validateSMTP: true, validateTypo: false, validateDisposable: true });
    if (r.valid) return { status: "safe" };
    const reason = r.reason as string | undefined;
    // If we simply couldn't complete the SMTP handshake, it's inconclusive, not invalid.
    if (reason === "smtp" && r.validators?.smtp?.reason && /timeout|connect|refused|unavailable/i.test(r.validators.smtp.reason)) {
      return { status: "unknown" };
    }
    if (reason === "mx") return { status: "invalid" };
    if (reason === "smtp") return { status: "invalid" };
    return { status: "unknown" };
  } catch {
    return null;
  }
}

// Unified verify: prefer Reoon (accurate, catch-all aware); fall back to free local
// SMTP when Reoon is unavailable or out of credits (returns null). onError surfaces a
// real Reoon failure (e.g. out of credits) so callers can flag "couldn't verify".
export async function verifyEmail(email: string, onError?: (msg: string) => void): Promise<Verdict> {
  const r = await verifyReoon(email, onError);
  if (r) return { status: r.catchAll ? "catch_all" : (r.safe ? "safe" : "invalid") };
  const local = await verifyLocal(email);
  return local ?? { status: "unknown" };
}
