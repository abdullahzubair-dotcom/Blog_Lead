import { NextRequest, NextResponse } from "next/server";
import { hasWebhook, setWebhook, getSlackMap, setSlackMap, hasBotToken, setBotToken, fetchSlackUsers } from "@/lib/linkaudit/slack";

// GET — settings state for the /link-audit page. Secrets (webhook, bot token) are never
// returned, only whether they're configured.
export async function GET() {
  const [webhook, slackMap, botToken] = await Promise.all([hasWebhook(), getSlackMap(), hasBotToken()]);
  return NextResponse.json({ hasWebhook: webhook, slackMap, hasBotToken: botToken });
}

// POST — replace the Slack webhook / bot token (both stored encrypted) and/or save the
// manual author→Slack-ID override map.
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
    if (typeof body.bot_token === "string" && body.bot_token.trim()) {
      const token = body.bot_token.trim();
      if (!/^xox[bp]-/.test(token)) {
        return NextResponse.json({ error: "That doesn't look like a Slack bot token (should start with xoxb-)" }, { status: 400 });
      }
      await setBotToken(token);
      // Validate immediately: can we actually list users with it?
      const users = await fetchSlackUsers();
      if (users.length === 0) {
        return NextResponse.json({ error: "Token saved, but listing users failed — check it has the users:read scope." }, { status: 400 });
      }
      if (body.slackMap && typeof body.slackMap === "object") await setSlackMap(body.slackMap);
      return NextResponse.json({ ok: true, directoryUsers: users.length });
    }
    if (body.slackMap && typeof body.slackMap === "object") {
      await setSlackMap(body.slackMap);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
