# Negotiation Agent — Change Log for Fork Porting

Date: 2026-07-24. All changes below are in `main` (commits `8cbd03b` bug fixes, `2b1afef` human-intervention feature). Port these to the fork; there is **one required DB migration** (§1).

Two things shipped:
- **A. Bug fixes** — wrong signer, a sent reply still showing "Send reply" (looked double-sendable), and a duplicated draft.
- **B. Human intervention** — the AI no longer promises things it can't do (attach a doc, jump on a call, share LinkedIn). It reads each reply and, when a real-world action/knowledge is needed, routes the thread to a new **Human intervention** bucket with two modes: **Assist** (you supply the missing input — including a document upload — and the AI writes a truthful reply) or **Handoff** (thread leaves the AI for you to reply yourself).

---

## 1. Required migration (run once against the fork's DB)

`scripts/040_negotiation_human_intervention.mjs` — additive only. `negotiation_status` is free-form text (no CHECK constraint), so the new values `needs_human` / `handoff` persist without altering any constraint.

```sql
ALTER TABLE outreach_emails
  ADD COLUMN IF NOT EXISTS intervention_type text,
  ADD COLUMN IF NOT EXISTS intervention_reason text,
  ADD COLUMN IF NOT EXISTS intervention_ask text,
  ADD COLUMN IF NOT EXISTS intervention_assist_input text,
  ADD COLUMN IF NOT EXISTS intervention_at timestamptz,
  ADD COLUMN IF NOT EXISTS intervention_asset_name text,
  ADD COLUMN IF NOT EXISTS intervention_asset_mime text,
  ADD COLUMN IF NOT EXISTS intervention_asset_b64 text;
CREATE INDEX IF NOT EXISTS idx_outreach_needs_human ON outreach_emails (negotiation_status) WHERE negotiation_status = 'needs_human';
```

Run: `node scripts/040_negotiation_human_intervention.mjs`. If the fork's DB *does* have a CHECK constraint on `negotiation_status`, extend it to allow `needs_human` and `handoff`.

No new environment variables. Document upload uses base64 in the row (no external storage). Email attachments already worked at the SMTP layer (`sendEmailAs`); the only new plumbing is passing them through `deliverOutreach`.

---

## 2. Bug fixes (commit `8cbd03b`)

### 2a. Wrong signer — "if Sabahat sent the email, why is Abdullah responding?"
`draftNegotiationReply` defaulted the sign-off to `"Abdullah"` (`agent.ts` `const signer = input.senderName || "Abdullah"`) because `run.ts` never passed `senderName`. Fix: `run.ts` now resolves the sender's name from the initial's sending inbox (`getUserEmailConfig(initial.sender_email).from_name`, else a first name derived from the address) and passes it as `senderName`. A thread Sabahat started is now signed "Sabahat". The canned accept/decline templates use the same `signer`, so they're fixed too.
- Files: `src/lib/negotiation/run.ts` (`firstNameFromEmail` helper + `senderName` passed), `src/lib/negotiation/agent.ts` (already had `input.senderName`).

### 2b. A sent reply still rendered as an editable draft with "Send reply"
A `kind='negotiation'` row with `status='sent'` is intentionally kept as history, but three read layers surfaced the latest child as an editable draft regardless of status, so a sent reply showed a textarea + green "Send reply". Clicking it 404s server-side (POST only acts on `draft`/`failed`), so it *looked* double-sendable but only ever sent once. Fix — enforce "sent = read-only history, only draft/failed is editable":
- `src/app/api/negotiation/threads/route.ts` — `draftBody` is `null` when the latest child is `sent` (keep `draftStatus` for the "AI replied" badge).
- `src/app/api/negotiation/[id]/route.ts` (GET) — added `.in("status", ["draft","failed"])` (matching what the POST already did).
- `src/app/negotiation/page.tsx` — a sent thread shows a read-only "AI reply sent" line, no Send button; `sendOrDiscard` clears `editBody[id]`/`convo[id]` so a stale draft can't linger.

### 2c. Duplicated draft
`getConversation` (`src/lib/db/queries.ts`) listed unsent `draft` rows as conversation bubbles while the same text also filled the draft textarea. Fix: exclude `status='draft'` from the conversation history (`if (r.body && r.status !== "failed" && r.status !== "draft")`), so a draft shows only in the editable box and a sent reply only in the conversation.

---

## 3. Human intervention (commit `2b1afef`)

### 3a. Detection — adaptive, AI-driven (`src/lib/negotiation/agent.ts`)
- `ReplyIntent` gains `"needs_human"`; new `InterventionType` union (13 labels). `ReplyClassification` gains `interventionType`, `interventionAsk`, `assistable`.
- `classifyReplyIntent`'s LLM prompt adds the `needs_human` label + definition and returns `interventionType`/`interventionAsk`/`assistable`. The label is described broadly so the model maps **any** real-world ask to the closest type (`other` is the adaptive catch-all) — it is not a fixed checklist.
- Deterministic fallback `classifyInterventionHeuristic(text)` (priority-ordered regex map) sets `needs_human` when there's no LLM, checked **before** the generic price/question defaults.

### 3b. Never fabricate (`agent.ts`)
- Removed the canned "I will get the assets and a short blurb over to you shortly" accept templates → now promise only a text blurb.
- Pricing guidance no longer says "we can supply assets and quotes".
- New HARD RULE: never promise to attach a file / share LinkedIn or a calendar link / schedule or join a call / state a specific traffic/turnaround/exclusivity/do-follow fact **unless** an `ASSIST CONTEXT` block is present.
- `ASSIST CONTEXT` block injected into the draft prompt when the human supplied input (`assistInput`) / attached a doc (`assistHasAttachment`) — "safe to quote verbatim".
- **Post-generation guard** (`FABRICATION_RE`): if a generated body promises a capability and no assist input/attachment backs it, the draft is discarded and `DraftResult.needsHuman=true` is returned so `run.ts` routes to a human. Defense-in-depth even if the classifier misses.

### 3c. Short-circuit + assist + autonomy guard (`src/lib/negotiation/run.ts`)
- `negotiateThread(emailId, { forceDraft?, assistInput? })`.
- If `intent === "needs_human"` **and not assisting**: no draft/send; stamp the anchor with `negotiation_status='needs_human'` + `intervention_type/ask/reason/at`; return.
- If the post-gen guard tripped (`draft.needsHuman`): same anchor flag (backstop).
- `autonomy` gate also excludes `needs_human` (a hollow reply is **never** auto-sent, even with autonomy on).
- Assist path: loads the uploaded doc (`intervention_asset_*`), passes `assistInput` + `assistHasAttachment` to the draft, and on success clears the intervention flags so the thread leaves the bucket (the asset is kept until the reply is actually sent).
- `INTERVENTION_REASON` map = human-readable "why a person is needed" per type.

### 3d. Out-of-office redirect (`src/lib/email/imap.ts`)
An OOO auto-reply's body (already in `reply_excerpt`) is parsed for an alternate contact (`extractAltEmail`, excluding our own addresses / the recipient / no-reply). If found, the thread is flagged `needs_human` / `redirect` with the alt email pre-filled — instead of dying in the dead-end `automated` bucket.

### 3e. Auto-loop guard (`src/app/api/emails/process/route.ts`)
The auto-negotiation selection skips `negotiation_status in ('agreed','declined','needs_human','handoff')`.

### 3f. API (`src/app/api/negotiation/[id]/route.ts`, `.../[id]/asset/route.ts`)
- `POST [id]` new actions: `assist` `{ assistInput }` (re-targets `recipient_override` for redirects, calls `negotiateThread(id,{assistInput,forceDraft:true})`, returns the truthful draft) and `handoff` (sets `negotiation_status='handoff'`, `ai_managed=false`, clears drafts).
- `POST [id]` `send` now attaches the anchor's staged document, then clears it after one send.
- New `POST/DELETE [id]/asset` — multipart upload (≤8MB) stored base64 on the anchor.
- `src/lib/email/deliver.ts` — `deliverOutreach` now accepts `attachments` and passes them to `sendEmailAs`.

### 3g. Threads API + UI (`src/app/api/negotiation/threads/route.ts`, `src/app/negotiation/page.tsx`)
- Threads route selects the intervention fields + `reply_from`; new `needs_human` bucket branch checked **before** `automated` (so an OOO-with-alt-contact lands in Human intervention).
- Page: new **Human intervention** tab; per-thread panel shows *what they asked* + *why a human is needed* + type badge, then either **Assist** (type-aware input — URL / text / email / availability, plus a **document upload** for asset/payment/other) → truthful draft to review + send, or **Handoff**. Attachment indicator on the Send button.

---

## 4. The intervention taxonomy (classifier guidance, not a hard gate)

`assist` = you provide an input and the AI continues; `handoff` = a person takes the thread.

| # | Type | Trigger (example) | Mode | Human provides |
|---|------|-------------------|------|----------------|
| 1 | asset_request | "share your one-pager / company overview" | assist | link, or **upload the doc** |
| 2 | asset_request | "do you have a deck / slides?" | assist | link to the deck |
| 3 | asset_request | "send your media kit / rate card" | assist | link, or which rate to quote |
| 4 | asset_request | "share case studies / portfolio / samples" | assist | 1-3 real links |
| 5 | asset_request | "send logo / hi-res images / brand assets" | assist | link to assets folder |
| 6 | identity_verification | "connect on LinkedIn" / "share your LinkedIn" | either | LinkedIn URL (assist) or connect + handoff |
| 7 | identity_verification | "what's your website? are you legit? references?" | assist | website / registration / references |
| 8 | sync_contact | "happy to jump on a call / Zoom / phone" | handoff | (a person runs the call) |
| 9 | scheduling | "send your availability / drop a Calendly" | assist | availability + timezone or booking link |
| 10 | redirect | OOO: "for urgent matters contact jane@…" | assist | confirm the alternate email (auto-detected) |
| 11 | redirect | "I've left / email my editor Sam" / wrong person | assist | correct name + email |
| 12 | process_portal | "submit via our form / vendor portal / sign up" | handoff | (person completes the submission) |
| 13 | legal_contract | "sign our NDA / contributor agreement / MSA" | handoff | (person/legal handles) |
| 14 | payment_details | "send an invoice / PO / W-9 / bank details" | assist | invoice link / PO / tax/bank (sensitive) |
| 15 | factual_question | "monthly traffic? do-follow? permanent? turnaround? exclusive?" | assist | the factual answer text |
| 16 | over_policy | "our minimum is $800" (above ceiling) / "6-month retainer / exclusive" | either | approved budget/terms, or decline |
| 17 | inbound_attachment | "attached is our agreement / draft / brief" | handoff | (person opens + decides) |
| 18 | other_channel | "message me on WhatsApp / here's my number" | handoff | (person moves channel) |
| 19 | other | anything else needing real-world action/knowledge | either | freeform instruction, or handoff |

---

## 5. Files touched

```
Migration:  scripts/040_negotiation_human_intervention.mjs                (new)
Agent:      src/lib/negotiation/agent.ts                                  (classify + guards + prompt)
            src/lib/negotiation/run.ts                                    (short-circuit + assist + signer)
Send loop:  src/app/api/emails/process/route.ts                           (skip needs_human/handoff)
Reply det.: src/lib/email/imap.ts                                         (OOO redirect; also 8cbd03b anchor/self-from)
Email:      src/lib/email/deliver.ts                                      (attachments passthrough)
API:        src/app/api/negotiation/threads/route.ts                      (needs_human bucket + fields + draftBody fix)
            src/app/api/negotiation/[id]/route.ts                         (assist/handoff/send-attach + GET draft fix)
            src/app/api/negotiation/[id]/asset/route.ts                   (new — document upload)
Queries:    src/lib/db/queries.ts                                         (getConversation excludes drafts)
UI:         src/app/negotiation/page.tsx                                  (Human intervention tab + panel; sent-draft fix)
```

## 6. Manual checks after porting
1. Run migration 040 on the fork's DB.
2. `npx tsc --noEmit && npm run build`.
3. Reply to a test thread asking for a one-pager → it lands in **Human intervention** (asset_request), not a hollow auto-reply; upload a PDF → Assist → the draft says it's attached → Send → the PDF actually goes out.
4. Reply "happy to jump on a call" → Human intervention (sync_contact, Handoff).
5. An out-of-office with "contact jane@…" → Human intervention (redirect, alt email pre-filled).
6. Confirm autonomy ON never auto-sends a needs_human thread.
