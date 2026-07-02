import { NextRequest, NextResponse } from "next/server";
import { sendEmail, verifyTransport } from "@/lib/email/smtp";

// POST { to } — sends a test email to verify SMTP is working.
export async function POST(req: NextRequest) {
  const { to } = await req.json().catch(() => ({}));
  if (!to) return NextResponse.json({ error: "recipient 'to' required" }, { status: 400 });

  const result = await sendEmail({
    to,
    subject: "GenAI Scout — test email",
    body: `Hi,\n\nThis is a test email from GenAI Scout confirming the outbound SMTP sender is configured and working.\n\nIf you're reading this, emails will send from ${process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER}.\n\n— GenAI Scout`,
  });

  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status });
}

// GET — verify the SMTP connection without sending.
export async function GET() {
  const result = await verifyTransport();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
