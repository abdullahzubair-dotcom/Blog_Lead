import { NextRequest, NextResponse } from "next/server";
import { hasWebhook, setWebhook, getSlackMap, setSlackMap } from "@/lib/linkaudit/slack";

// GET — settings state for the /link-audit page. The webhook itself is never returned,
// only whether one is configured.
export async function GET() {
  const [webhook, slackMap] = await Promise.all([hasWebhook(), getSlackMap()]);
  return NextResponse.json({ hasWebhook: webhook, slackMap });
}

// POST — replace the Slack webhook (stored encrypted) and/or save the author→Slack-ID map.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.webhook === "string" && body.webhook.trim()) {
      const url = body.webhook.trim();
      if (!/^https:\/\/hooks\.slack\.com\//.test(url)) {
        return NextResponse.json({ error: "That doesn't look like a Slack webhook URL (should start with https://hooks.slack.com/)" }, { status: 400 });
      }
      await setWebhook(url);
    }
    if (body.slackMap && typeof body.slackMap === "object") {
      await setSlackMap(body.slackMap);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
