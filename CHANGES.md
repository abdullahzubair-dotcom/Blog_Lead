# Negotiation Agent — Change Log & Context for Fork Porting

Date: 2026-07-24. Shipped on `main` across commits `8cbd03b`, `2b1afef`, `ecb86b8`, `37e2723`.
Port these to the fork. There is **one required DB migration** (§2) and **two one-time data cleanups** (§9).

> **Read §1 first.** It explains the failure modes these changes exist to prevent. Several fixes look
> removable/simplifiable but are load-bearing — each has a **⚠️ Don't reintroduce** note. Undoing one
> brings back a specific, user-visible bug (hollow promises, spammed writers, phantom double-sends).

---

## 1. Background — why any of this exists

The negotiation agent is **email-only and runs unattended**. When `ai_autonomy` is ON, the cron
(`/api/emails/process`, every ~30 min) auto-classifies each inbound reply and, for "active" threads,
auto-drafts **and sends** the next negotiation email with zero human review. That combination means
any weakness in classification or drafting goes straight out to a real journalist's inbox.

Two structural facts drive every change below:

1. **The AI can only send plain email text.** It cannot attach a file, join a call, connect on
   LinkedIn, fill a portal, sign a contract, or know a real stat (traffic, do-follow, turnaround).
   The old prompt actively encouraged it to *promise* these anyway ("we can supply assets", canned
   "I'll get the assets over to you"). Result: it told writers it had attached a one-pager it never
   sent, and agreed to calls it couldn't take. → §5 (Human intervention).

2. **The loop re-runs every 30 min and trusts `replied_at` / `negotiation_status`.** If those get
   corrupted, the loop misfires silently and repeatedly. The reply detector used to re-stamp
   `replied_at = now()` on *every* sweep, so the loop thought there was a new reply each time and
   answered again → one writer got **6** escalating emails for a single reply. → §6 (runaway guard).

Real incidents that motivated the work (use these as regression cases):
- **Abhinav Jain / "share your one-pager, LinkedIn, and jump on a call"** → the AI replied "I've
  attached our one-pager and LinkedIn" (nothing attached) and "happy to jump on a call". Hollow.
- **Russell S.A. Palmer** → AI sent 6 replies to one message, then marked the thread `agreed` with
  **$30 owed** even though Russell said "we can *waive the fee*". Runaway + false payment.
- **Sabahat's thread signed "Best, Abdullah"** → every AI reply was signed by the wrong person.

---

## 2. Required migration (run once on the fork's DB)

`scripts/040_negotiation_human_intervention.mjs` — additive only.

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

**Context:** `negotiation_status` is free-form `text` with **no CHECK constraint** in this project
(confirmed: values `negotiating/agreed/declined/stalled` in use, no constraint). The new values
`needs_human` and `handoff` therefore persist with no schema change. **⚠️ If your fork added a CHECK
constraint on `negotiation_status`, extend it to allow `needs_human` and `handoff`, or every insert/
update in §5–§6 will throw.** No new env vars. Document uploads are base64 on the row (no external
storage), attached at send via `sendEmailAs` (which already supported attachments).

---

## 3. Bug fix — wrong signer (commit `8cbd03b`)

- **Symptom:** a thread Sabahat sent was signed "Best, Abdullah" in every AI reply.
- **Root cause:** `agent.ts` had `const signer = input.senderName || "Abdullah"` and `run.ts` never
  passed `senderName`, so it *always* fell back to the hardcoded "Abdullah".
- **Fix:** `run.ts` resolves the name from the inbox the reply is actually sent from
  (`getUserEmailConfig(initial.sender_email).from_name`, else `firstNameFromEmail(address)`) and
  passes it as `senderName`. The canned accept/decline templates use the same `signer`, so fixed too.
- **⚠️ Don't reintroduce:** never hardcode a signer name. The reply goes out from
  `initial.sender_email`; the sign-off must match that person, not whoever wrote the code.

## 4. Bug fix — sent reply looked re-sendable / duplicated (commit `8cbd03b`)

- **Symptom:** after the AI sent a reply, the Negotiation page still showed that reply in an editable
  box with a green **"Send reply"** button (looked like you could double-send), and the same text
  appeared twice (once as a conversation bubble, once in the textarea).
- **Root cause:** a `kind='negotiation'` row with `status='sent'` is kept as history, but three read
  paths surfaced the *latest* child as an editable draft with no status check. (The backend POST only
  acts on `draft`/`failed`, so a second click 404'd — it *looked* double-sendable but sent once.)
- **Fix — the invariant: `status='sent'` is read-only history; only `draft`/`failed` is editable.**
  All three must hold together:
  1. `threads/route.ts` — `draftBody = null` when the latest child is `sent` (keep `draftStatus` for
     the "AI replied" badge).
  2. `negotiation/[id]/route.ts` GET — `.in("status", ["draft","failed"])` (the POST already did this).
  3. `getConversation` (`queries.ts`) — exclude `status='draft'` rows from the conversation, so a
     draft shows only in the textarea and a sent reply only in the conversation.
  4. `negotiation/page.tsx` — sent thread shows a read-only "AI reply sent" line; `sendOrDiscard`
     clears `editBody[id]`/`convo[id]` so a stale draft can't linger.
- **⚠️ Don't reintroduce:** if you revert *any one* of 1–3 the phantom returns. In particular, don't
  let `getConversation` include `draft` rows and don't drop the GET status filter.

---

## 5. Feature — Human intervention (commit `2b1afef`)

**Why:** see §1 fact #1. The AI must **never promise a capability it lacks**. Instead it detects
"this needs a real-world action/knowledge" and routes the thread to a **Human intervention** bucket
with two modes: **Assist** (human supplies the missing input — link / text / availability / redirect
email / **document upload** — and the AI then writes a *truthful* reply) or **Handoff** (thread leaves
the AI for the human to reply).

### 5a. Detection — `agent.ts` `classifyReplyIntent`
- New intent `needs_human` + `InterventionType` (13 labels, see §8) + `interventionAsk`/`assistable`
  on `ReplyClassification`. The LLM prompt describes `needs_human` **broadly** so it maps *any* ask to
  the nearest type (`other` = adaptive catch-all). It is deliberately **not** a fixed keyword list.
- Deterministic `classifyInterventionHeuristic()` fallback for when there's no LLM key.
- **STRONG-cue override:** even when the LLM labels a reply positively, unambiguous "AI literally
  can't do this" cues (`sync_contact`, `other_channel`, `legal_contract`, `process_portal`,
  `payment_details`, `inbound_attachment`) force `needs_human`.
  - **Why it exists (example):** "happy to jump on a quick call" was classified `interested` by the
    LLM (the tone *is* positive) and would have been auto-answered. The override catches it as
    `sync_contact`. Softer types (asset/factual/scheduling) stay LLM-driven to avoid false positives
    like "I loved your case study" wrongly tripping `asset_request`.
- **⚠️ Don't reintroduce:** don't narrow `needs_human` to a rigid keyword list (it must generalize),
  and don't drop the STRONG override or the call-request regression returns.

### 5b. Never fabricate — `agent.ts` `draftNegotiationReply`
- Removed the canned accept templates that said "I will get the assets and a short blurb over to you"
  → now promise only a text blurb.
- Pricing guidance no longer says "we can supply assets and quotes".
- **HARD RULE** added to the prompt: never promise to attach a file / share LinkedIn or a calendar
  link / schedule or join a call / state a specific traffic/turnaround/exclusivity/do-follow fact
  **unless** an `ASSIST CONTEXT` block is present.
- `ASSIST CONTEXT` block is injected only when the human supplied `assistInput` / `assistHasAttachment`
  — "safe to quote verbatim". This is what makes the Assist path produce a *truthful* reply.
- **Post-generation guard** `FABRICATION_RE`: if the generated body still promises a capability and no
  assist input/attachment backs it, the draft is **discarded** and `DraftResult.needsHuman = true` is
  returned → `run.ts` routes to a human. Defense-in-depth for when the classifier misses.
- **⚠️ Don't reintroduce:** don't re-add "assets"/attachment promises to the canned templates or the
  brief. Keep `FABRICATION_RE` — it is the last line that makes a hollow promise structurally
  impossible to send.

### 5c. Short-circuit + assist + autonomy guard — `run.ts` `negotiateThread`
- Signature `negotiateThread(emailId, { forceDraft?, assistInput? })`.
- **Order matters:** the `needs_human` check runs **immediately after classify and BEFORE
  `draftNegotiationReply`** — so for these replies the LLM is never even asked to draft. It stamps the
  anchor (`negotiation_status='needs_human'` + `intervention_type/ask/reason/at`) and returns.
- A second check after drafting handles the `FABRICATION_RE` backstop (`draft.needsHuman`).
- The `autonomy` gate excludes `needs_human` (belt-and-braces: even if a draft slipped through, it
  can't auto-send).
- Assist path: loads the uploaded doc, passes `assistInput` + `assistHasAttachment`, clears the
  intervention flags on success (asset kept until the reply is actually sent).
- **⚠️ Don't reintroduce:** never move the `needs_human` short-circuit to *after* the draft call —
  that would generate (and, under autonomy, send) the hollow reply before the check. Keep the autonomy
  gate exclusion.

### 5d. OOO alternate-contact redirect — `imap.ts`
- **Why (example):** an out-of-office auto-reply often says "I'm away, for urgent matters contact
  jane@pub.com". That address is already in `reply_excerpt` but the old code let the thread die in the
  no-action `automated` bucket.
- **Fix:** in the `auto` branch, `extractAltEmail()` pulls an address that isn't ours / the recipient /
  a no-reply, and flags the thread `needs_human` / `redirect` with the alt email pre-filled.

### 5e. Auto-loop guard — `process/route.ts`
- The auto-negotiation selection skips `negotiation_status in ('agreed','declined','needs_human','handoff')`.
- **Why:** a `needs_human`/`handoff` thread is a person's job; the AI must not pick it back up.

### 5f. API + attachments
- `POST /api/negotiation/[id]` gains actions **`assist`** `{ assistInput }` (re-targets
  `recipient_override` for redirects, then `negotiateThread(id,{assistInput,forceDraft:true})`) and
  **`handoff`** (`negotiation_status='handoff'`, `ai_managed=false`, clears drafts). `send` now
  attaches the anchor's staged document and clears it after one send.
- New `POST/DELETE /api/negotiation/[id]/asset` — multipart upload (≤8 MB) → base64 on the anchor.
- `deliver.ts` `deliverOutreach` gained an `attachments` param passed to `sendEmailAs`.
- **⚠️ Don't reintroduce:** the env-SMTP fallback (`sendEmail`, no per-user sender) has **no**
  attachment support; document-attach only works when a `sender` is set (always true for negotiation).

### 5g. UI — `negotiation/page.tsx`, `threads/route.ts`
- New **Human intervention** tab. The `needs_human` bucket branch in `threads/route.ts` is checked
  **before** `automated` (so an OOO-with-alt-contact lands in Human intervention, not Automated).
- Panel shows *what they asked* + *why a human is needed* + type badge, then **Assist** (type-aware
  input; document upload for asset/payment/other) or **Handoff**.
- **Sent-from filter:** searchable `SearchableSelect` (same component as "add prospect") lists the
  distinct sending accounts; picking one filters any tab to that teammate's threads.

---

## 6. Follow-up fixes — runaway guard & waive-fee (commits `ecb86b8`, `37e2723`)

### 6a. Runaway auto-negotiation — the Russell "6 replies, marked agreed" bug
- **Symptom:** one writer received 6 escalating AI emails for a single reply; the thread then flipped
  to `agreed` with a bogus amount owed.
- **Root cause (two parts):**
  1. The reply detector re-stamped `replied_at = now()` on **every** cron sweep, so the loop's
     `lastAnswer >= latestReply` guard never held — it kept seeing a "newer" reply and re-answering.
  2. `max_thread_length` (default 4, "max AI messages before escalating to a human") existed in
     settings but was **never enforced** anywhere.
- **Fix:**
  - Idempotent reply attribution (`imap.ts` `recordReplyOnAnchor`, from `8cbd03b`) stops the re-stamp:
    it won't re-write `replied_at`/excerpt if the same reply is already recorded.
  - **Hard reply cap** in the loop (`process/route.ts`): count `kind='negotiation'` sent replies in
    the thread; at `settings.max_thread_length` it sets `needs_human` (escalate) instead of replying.
- **⚠️ Don't reintroduce:** keep `recordReplyOnAnchor` idempotent (don't re-stamp `replied_at` with
  `now()` unconditionally) **and** keep the loop cap. Either alone is insufficient — the cap is the
  backstop if attribution ever regresses.

### 6b. Waive-fee → no payment owed
- **Symptom:** "we can waive the fee, it's fine" was booked as `agreed` with the DR ceiling **owed**.
- **Fix (`run.ts`):** if the latest reply matches waive/free/no-charge/complimentary, an `agreed` is
  recorded as a placement at **0 with `payment_status = null`** (nothing owed).
- **⚠️ Note:** this is a heuristic on the reply text; it only zeroes the amount, it doesn't decline.

---

## 7. Inbox — "Needs your reply" section + AI-managed lock (commit `37e2723`)

- **Why:** (1) users wanted a single place to see replies that are actually waiting on *them*; (2) a
  human replying from the inbox to a thread the AI negotiator is actively working would collide with
  the AI (two replies to one message — the same class of bug as the runaway).
- **`getInboxList` / `InboxPerson`** gain `needs_reply`, `ai_managed`, `negotiation_status`.
  `needs_reply` = a genuine (non-`auto`) reply that **nobody has answered since** (no `kind='negotiation'`
  sent after their `replied_at`) and the thread isn't `agreed`/`declined`/`handoff`.
- **Inbox UI:** new **"Needs your reply"** tab (filters `needs_reply`); count added in the list route.
- **AI-managed lock:** when a thread is `ai_managed` and still actively negotiating
  (`negotiation_status` null or `negotiating`), the compose box is disabled with a banner pointing to
  the Negotiation page, and `POST /api/inbox/[id]/reply` returns **409** (unless `overrideAiManaged`).
- **⚠️ Don't reintroduce:** don't remove the server-side 409 — the disabled textarea is only a UI hint;
  the API check is the real guard. `needs_human`/`handoff` threads are intentionally **not** locked
  (a human is meant to reply to those).

---

## 8. Intervention taxonomy (classifier guidance, not a hard gate)

`assist` = human provides an input, AI continues; `handoff` = a person takes the thread.

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
| 16 | over_policy | "our minimum is $800" (above ceiling) / "6-month retainer" | either | approved budget/terms, or decline |
| 17 | inbound_attachment | "attached is our agreement / draft / brief" | handoff | (person opens + decides) |
| 18 | other_channel | "message me on WhatsApp / here's my number" | handoff | (person moves channel) |
| 19 | other | anything else needing real-world action/knowledge | either | freeform instruction, or handoff |

---

## 9. One-time data cleanups (run once on the fork after porting)

New replies are handled correctly going forward; these fix threads that arrived *before* the code shipped.

1. **Reclassify existing active replies.** For each active `kind='initial'` (status not
   agreed/declined/needs_human/handoff/bounced), take the latest `reply_kind='reply'` excerpt in the
   thread, call `classifyReplyIntent`, and if `needs_human` set `negotiation_status='needs_human'` +
   `intervention_type/ask/reason/at` on the anchor. (On this repo it moved 3: an asset request, a
   call, an inbound attachment.)
2. **Escalate past runaways.** Any anchor with `>= max_thread_length` sent `kind='negotiation'`
   children: `UPDATE ... SET negotiation_status='needs_human', agreed_price=NULL, payment_status=NULL`
   (clears the bogus "owed" and hands it to a person). On this repo that was the Russell thread.

Both were done here with throwaway scripts using the TS-loader
(`node --import ./scripts/_disc_register.mjs <script>.mjs`) so they call the *real* `classifyReplyIntent`.

---

## 10. Files touched

```
Migration:  scripts/040_negotiation_human_intervention.mjs                (new)
Agent:      src/lib/negotiation/agent.ts                                  (classify + STRONG override + never-fabricate + guard)
            src/lib/negotiation/run.ts                                    (short-circuit + assist + signer + waive-fee)
Send loop:  src/app/api/emails/process/route.ts                           (skip needs_human/handoff + reply cap)
Reply det.: src/lib/email/imap.ts                                         (self-from + anchor idempotent attribution + OOO redirect)
Email:      src/lib/email/deliver.ts                                      (attachments passthrough)
API:        src/app/api/negotiation/threads/route.ts                      (needs_human bucket + fields + draftBody fix)
            src/app/api/negotiation/[id]/route.ts                         (assist/handoff/send-attach + GET draft fix)
            src/app/api/negotiation/[id]/asset/route.ts                   (new — document upload)
Queries:    src/lib/db/queries.ts                                         (getConversation excludes drafts; getInboxList needs_reply/ai_managed)
UI:         src/app/negotiation/page.tsx                                  (Human intervention tab + panel; sent-draft fix; sender filter)
Inbox:      src/app/inbox/page.tsx                                        (Needs-your-reply tab + AI-managed compose lock)
            src/app/api/inbox/route.ts                                    (needs_reply count)
            src/app/api/inbox/[id]/reply/route.ts                         (409 when AI-managed)
```

## 11. Manual checks after porting
1. Run migration 040; run the two cleanups in §9.
2. `npx tsc --noEmit && npm run build`.
3. Reply to a test thread asking for a one-pager → lands in **Human intervention** (asset_request),
   not a hollow auto-reply; upload a PDF → **Assist** → the draft says it's attached → **Send** → the
   PDF actually goes out; the thread leaves the bucket.
4. Reply "happy to jump on a call" → Human intervention (`sync_contact`, Handoff) even though the tone
   is positive (STRONG override).
5. OOO with "contact jane@…" → Human intervention (`redirect`, alt email pre-filled).
6. With `ai_autonomy` ON: confirm a `needs_human` thread is **never** auto-sent, and that no thread
   ever receives more than `max_thread_length` AI replies.
7. Inbox: a thread the AI is actively negotiating shows the compose box disabled + returns 409 on a
   forced POST; a replied-and-unanswered thread appears under **"Needs your reply"**.
