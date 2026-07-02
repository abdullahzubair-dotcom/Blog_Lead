# Email sending cron (Vercel Hobby)

Emails are scheduled with `scheduled_at` times and actually sent when something hits
`POST /api/emails/process` (sends all due emails, batches of 25). That endpoint needs
to be called on a schedule.

## The Hobby-plan problem

Vercel **Hobby** cron jobs run **at most once per day**. That's why `vercel.json` is set
to a single daily run (`0 13 * * *`) as a backstop — it is NOT enough for time-of-day
drip sending. For per-minute sending you need an external caller.

## Recommended: cron-job.org (free, every minute)

1. Sign up at https://cron-job.org
2. Create a cronjob:
   - **URL:** `https://<your-app>.vercel.app/api/emails/process?key=YOUR_CRON_SECRET`
     (or use a request header `Authorization: Bearer YOUR_CRON_SECRET` instead of the `?key=`)
   - **Method:** POST
   - **Schedule:** every 1 minute
3. Save. It will now send any due emails every minute, at each recipient's local time.

`YOUR_CRON_SECRET` must match the `CRON_SECRET` env var set in Vercel
(Project → Settings → Environment Variables).

## Alternative: upgrade to Vercel Pro

On Pro, set `vercel.json` schedule to `* * * * *` (every minute) and Vercel's own cron
handles it — no external service needed. Vercel automatically sends the
`Authorization: Bearer $CRON_SECRET` header.

## Env vars to set in Vercel

Copy these from `.env.local` into Vercel's Environment Variables:
`SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_NAME, SMTP_FROM_EMAIL,
CRON_SECRET, BLITZ_API_KEY, OPENROUTER_API_KEY, DATABASE_URL,
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_URL, APP_URL`
