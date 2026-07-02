import nodemailer from "nodemailer";

// Single reusable SMTP transport, built from .env.local credentials.
// Gmail app password auth over implicit TLS (port 465).
let transporter: nodemailer.Transporter | null = null;

export function getTransport(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 = implicit TLS, 587 = STARTTLS
      auth: { user, pass },
    });
  }
  return transporter;
}

export function fromAddress(overrideName?: string, overrideEmail?: string): string {
  const name = overrideName ?? process.env.SMTP_FROM_NAME ?? "";
  const email = overrideEmail ?? process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER ?? "";
  return name ? `"${name}" <${email}>` : email;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
  fromEmail?: string;
}): Promise<SendResult> {
  const tx = getTransport();
  if (!tx) return { ok: false, error: "SMTP not configured (missing SMTP_HOST/USER/PASS)" };

  try {
    const info = await tx.sendMail({
      from: fromAddress(opts.fromName, opts.fromEmail),
      to: opts.to,
      subject: opts.subject,
      text: opts.body,
      // Simple text→HTML: preserve line breaks
      html: opts.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>"),
    });
    return { ok: true, messageId: info.messageId };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "send failed" };
  }
}

// Verify the SMTP connection/credentials without sending anything.
export async function verifyTransport(): Promise<SendResult> {
  const tx = getTransport();
  if (!tx) return { ok: false, error: "SMTP not configured" };
  try {
    await tx.verify();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "verify failed" };
  }
}
