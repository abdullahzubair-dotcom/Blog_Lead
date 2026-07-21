# Enabling live Google Search Console data (Page Health)

The Page Health tool predicts each page's Google status from a live crawl. Once a Search Console
**service account** is connected, it *also* shows the **real** status Google reports
("Google says: …" next to each page), turning the predictions into a verified monitor (PRD R3).

Everything below is a one-time Google-side setup — the code is already wired and will light up
automatically once these env vars are present.

## 1. Enable the API + create a service account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → pick (or create) a project.
2. **APIs & Services → Library →** search **"Google Search Console API"** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account.**
   - Name it e.g. `seo-page-health`. No roles/permissions are needed at the project level. Create.
4. Open the new service account → **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
   Keep it secret — it's a credential.

## 2. Grant it access to the imagine.art property

1. Open [Search Console](https://search.google.com/search-console) and select the **imagine.art** property.
2. **Settings → Users and permissions → Add user.**
3. Paste the service account's email (looks like `seo-page-health@<project>.iam.gserviceaccount.com`).
4. Permission **Restricted** is enough (read-only). Add.

## 3. Set the environment variables

Add to `.env.local` locally, and to the Vercel project's Environment Variables for production:

```
# Exactly as verified in Search Console:
#   domain property   → sc-domain:imagine.art
#   URL-prefix property → https://www.imagine.art/
GSC_PROPERTY=sc-domain:imagine.art

# The downloaded service-account JSON. Inline is easiest on Vercel (no file paths).
# Paste the whole JSON on one line:
GSC_SA_JSON={"type":"service_account","project_id":"…", …}

# …or, if inline quoting is awkward, base64 it instead (use ONE of the two):
#   macOS:  base64 -i service-account.json | pbcopy
# GSC_SA_JSON_BASE64=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50Ii...
```

Restart `npm run dev` (or redeploy). That's it — no code changes.

## 4. What you'll see

- The **All pages** tab shows **"Google says: <coverage state>"** for each URL, next to the tool's
  own prediction on the right. Agreement builds trust; a mismatch is itself a signal worth a look.
- The scan inspects up to **40 URLs per run** to stay well inside GSC's quota
  (~2,000 inspections/day, 600/min, one URL per call).

## Notes

- Without these vars the tool runs exactly as before (prediction-only) — nothing breaks.
- The service-account JSON is a secret. It's read from an env var, never committed; `.env.local`
  is git-ignored.
