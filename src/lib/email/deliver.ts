import { getUserEmailConfig, getUserAppPasswordEnc } from "@/lib/db/queries";
import { decryptSecret } from "@/lib/crypto";
import { sendEmail, sendEmailAs, type SendResult } from "./smtp";

// Deliver one outreach email from the right identity: the stamped per-user sender's own
// Gmail (their app password), or the server SMTP identity for legacy/unstamped emails.
// Shared by the batch processor and the per-email "Send now" action.
export async function deliverOutreach(opts: {
  to: string; subject: string; body: string; sender?: string | null;
}): Promise<SendResult> {
  if (opts.sender) {
    const pass = decryptSecret(await getUserAppPasswordEnc(opts.sender));
    if (!pass) return { ok: false, error: `${opts.sender} hasn't set a Gmail app password (Settings → Your sending email)` };
    const cfg = await getUserEmailConfig(opts.sender);
    return sendEmailAs({ user: opts.sender, pass, fromName: cfg.from_name, to: opts.to, subject: opts.subject, body: opts.body });
  }
  return sendEmail({ to: opts.to, subject: opts.subject, body: opts.body });
}
