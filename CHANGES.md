# Changes to port — batch 2 (Inbox: needs-reply fix + AI tags)

Date: 2026-07-24. This file contains **only the newest batch** so it's clean to transfer.
The earlier negotiation batch (human-intervention, runaway guard, waive-fee, signer/sent-draft
fixes) is in git history at commit `0b415a3` if you still need it — already ported.

**One required migration** (§1). Builds on the previous batch (the "Needs your reply" tab and the
AI-managed compose lock already existed; this batch **fixes** their logic and adds visible AI tags).

---

## 1. Required migration (run once on the fork's DB)

`scripts/041_inbox_last_reply.mjs` — additive:

```sql
ALTER TABLE inbox_state ADD COLUMN IF NOT EXISTS last_reply_at timestamptz;
```

Run: `node scripts/041_inbox_last_reply.mjs`. No new env vars.

---

## 2. Fix — "Needs your reply" was showing threads we already answered

- **Symptom:** the **Needs your reply** tab listed threads we had **already replied to by hand** from
  the inbox (e.g. Anthony Ha — last message in the thread was our own "No worries, thanks!" reply,
  yet it sat in "Needs your reply").
- **Root cause:** `needs_reply` treated a thread as "answered" only if there was a `kind='negotiation'`
  (AI) reply sent after their reply. **Manual inbox replies are sent straight over SMTP and never
  create an `outreach_emails` row**, so a hand-answered thread looked unanswered forever.
- **Fix (three parts):**
  1. **Record manual replies.** New `inbox_state.last_reply_at` (migration §1) + `markInboxReplied()`
     in `queries.ts`. `POST /api/inbox/[id]/reply` calls it after a successful send.
  2. **Self-heal on open (fixes the backlog).** `GET /api/inbox/[id]` already pulls the live IMAP
     conversation with per-message `direction`. It now takes the latest **outbound** message's date
     and records it as `last_reply_at` — so any thread we answered *before* this tracking existed is
     corrected the moment it's opened (IMAP is ground truth).
  3. **Count both signals.** `getInboxList` now computes `answeredAt = max(last AI negotiation
     sent_at, inbox_state.last_reply_at)`. `needs_reply` = a genuine (non-`auto`) reply, thread not
     `agreed`/`declined`/`handoff`, and **their `replied_at` is newer than `answeredAt`**.
- **⚠️ Don't reintroduce:** don't compute "answered" from `kind='negotiation'` rows alone — manual
  inbox replies must count too, or this bug returns. Keep the self-heal in the thread GET; it's what
  clears threads answered before tracking existed (no manual DB backfill needed).

---

## 3. AI tags + "don't reply here" warning in the Inbox

- **Why:** a human replying from the inbox to a thread the AI negotiator is actively working collides
  with the AI (two replies to one message). The compose box was already disabled + a banner shown for
  the *selected* thread, but there was **no at-a-glance signal in the list**, so you couldn't tell
  which conversations are AI-controlled without opening each one.
- **Added (`src/app/inbox/page.tsx`):**
  - **List row badge** — a violet **`🤖 AI`** tag on every thread that is `ai_managed` and still
    actively negotiating (`negotiation_status` null or `negotiating`), with tooltip "The AI
    negotiator is handling this thread — don't reply here." Plus an amber **`needs reply`** tag on
    `needs_reply` rows.
  - **Conversation header badge** — `🤖 AI negotiating` next to the name when the open thread is
    AI-locked.
  - (Existing, from batch 1, still in place: the compose textarea/Send are **disabled** with a banner
    when AI-locked, and `POST /api/inbox/[id]/reply` returns **409** unless `overrideAiManaged`.)
- **⚠️ Note:** the badge/lock condition is `ai_managed && negotiation_status ∈ {null, 'negotiating'}`.
  A thread that is `needs_human`/`handoff`/`agreed`/`declined` is intentionally **not** AI-locked (a
  person is meant to handle those). The server-side 409 is the real guard; the badge + disabled box
  are UI hints.

---

## 4. Files touched (this batch)

```
Migration:  scripts/041_inbox_last_reply.mjs                     (new — inbox_state.last_reply_at)
Queries:    src/lib/db/queries.ts                                (getInboxList counts manual replies; new markInboxReplied)
Inbox API:  src/app/api/inbox/[id]/reply/route.ts                (record our reply after send)
            src/app/api/inbox/[id]/route.ts                      (self-heal last_reply_at from last outbound IMAP msg)
Inbox UI:   src/app/inbox/page.tsx                               (AI + needs-reply list badges; AI-negotiating header badge)
```

## 5. Manual checks after porting
1. Run migration 041.
2. `npx tsc --noEmit && npm run build`.
3. Open a thread you've already replied to from the inbox → it disappears from **Needs your reply**
   (self-heal on open); reply to a fresh reply → it leaves the tab immediately.
4. A thread the AI is actively negotiating shows the **`🤖 AI`** tag in the list and an
   **AI negotiating** badge + disabled compose in the conversation; a forced reply POST returns 409.
