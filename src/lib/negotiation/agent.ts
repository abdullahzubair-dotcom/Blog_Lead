import type { NegotiationSettings } from "./settings";

// ── Shared OpenRouter call (same pattern as followups / ai-search) ──────────────
async function llm(prompt: string, maxTokens = 400, temperature = 0.4): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.length < 20) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "anthropic/claude-haiku-4-5", messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.choices?.[0]?.message?.content ?? "").trim() || null;
  } catch {
    return null;
  }
}

// Enforce "no em/en dashes" (and tidy spacing) on every generated email, regardless of what
// the model returns. em dash and en dash become commas; stray doubles get cleaned up.
function sanitizeBody(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[—–]/g, ", ")
    .replace(/ ,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const AGGRESSION: Record<string, string> = {
  gentle: "Be gentle. Move up slowly and only if they push, prefer settling below the ceiling, and lean toward a free or editorial inclusion if they hesitate on price.",
  balanced: "Be balanced. Move in modest steps and aim to land comfortably under the ceiling.",
  firm: "Be firm. Hold close to your opening number, concede minimally and slowly, and only approach the ceiling when the placement is clearly high value.",
};

export type ReplyIntent =
  | "interested" | "counter_offer" | "accept" | "question"
  | "hard_no" | "unsubscribe" | "auto" | "irrelevant" | "needs_human";

// The finite set of "why a human is needed" categories. Kept broad; the classifier maps any
// real-world ask to the closest one, and "other" is the adaptive catch-all so new asks still route.
export type InterventionType =
  | "asset_request" | "identity_verification" | "sync_contact" | "scheduling" | "redirect"
  | "process_portal" | "legal_contract" | "payment_details" | "factual_question"
  | "over_policy" | "inbound_attachment" | "other_channel" | "other";

export interface ReplyClassification {
  intent: ReplyIntent;
  priceMentioned: number | null; // a $ figure they named, if any
  reason: string;
  interventionType?: InterventionType; // set only when intent === "needs_human"
  interventionAsk?: string;            // short "what they literally asked for", shown to the human
  assistable?: boolean;                // true = a human input lets the AI continue; false = full handoff
}

// Classify an inbound reply so the AI knows how to respond (and so hard-no / unsubscribe /
// automated messages get pulled OUT of the negotiation queue). Falls back to a keyword
// heuristic when no LLM key is set — never throws.
export async function classifyReplyIntent(replyText: string, subject = ""): Promise<ReplyClassification> {
  const text = `${subject}\n${replyText}`.trim().slice(0, 4000);
  const out = await llm(
    `Classify this inbound reply to a media-outreach email. Return ONLY compact JSON:
{"intent": one of ["interested","counter_offer","accept","question","hard_no","unsubscribe","auto","irrelevant","needs_human"], "priceMentioned": number or null, "reason": "<=12 words", "interventionType": one of ["asset_request","identity_verification","sync_contact","scheduling","redirect","process_portal","legal_contract","payment_details","factual_question","over_policy","inbound_attachment","other_channel","other"] or null, "interventionAsk": "<=15 words: what they literally asked for" or null, "assistable": true or false}

Definitions:
- interested: open to featuring/including us, positive, wants to talk.
- counter_offer: names their own price or terms.
- accept: agrees to our proposal/price.
- question: a simple info question you can answer from the negotiation itself (not a factual company stat).
- hard_no: clearly declines / not interested / "we don't do this".
- unsubscribe: asks to stop emailing / remove them.
- auto: automated out-of-office / autoresponder / no-reply.
- irrelevant: spam or unrelated.
- needs_human: asks for something an EMAIL-ONLY AI cannot do or must not fabricate. This is the priority label whenever it applies. Set interventionType, interventionAsk, and assistable when you use it. It covers: sending/attaching a file (one-pager, deck, media kit, samples, portfolio, logo, images) [asset_request, assistable]; connecting on LinkedIn or proving the company is real (website, registration, references) [identity_verification, assistable]; jumping on a call/Zoom/phone/meeting [sync_contact, usually NOT assistable]; sharing availability or a calendar link [scheduling, assistable]; being redirected to another contact / "email my editor X" / "I've left the company" [redirect, assistable]; submitting via a form/portal or creating an account [process_portal, NOT assistable]; signing an NDA/contract/MSA [legal_contract, usually NOT assistable]; invoice/PO/bank/tax details [payment_details, assistable]; a factual question about traffic/DAU/do-follow/permanence/turnaround/exclusivity/deliverables the AI must not invent [factual_question, assistable]; a commitment above our price ceiling or a retainer/long-term/exclusivity deal [over_policy, assistable]; reviewing a file THEY attached [inbound_attachment, NOT assistable]; moving to WhatsApp/Telegram/phone/text [other_channel, NOT assistable]; anything else needing a real-world action or knowledge the AI lacks [other].

Reply:
"""${text}"""`,
    260, 0
  );
  if (out) {
    const m = out.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const j = JSON.parse(m[0]);
        const intent: ReplyIntent = ["interested", "counter_offer", "accept", "question", "hard_no", "unsubscribe", "auto", "irrelevant", "needs_human"].includes(j.intent) ? j.intent : "interested";
        const price = typeof j.priceMentioned === "number" ? j.priceMentioned : null;
        const base: ReplyClassification = { intent, priceMentioned: price, reason: String(j.reason ?? "").slice(0, 80) };
        if (intent === "needs_human") {
          const IT: InterventionType[] = ["asset_request", "identity_verification", "sync_contact", "scheduling", "redirect", "process_portal", "legal_contract", "payment_details", "factual_question", "over_policy", "inbound_attachment", "other_channel", "other"];
          base.interventionType = IT.includes(j.interventionType) ? j.interventionType : "other";
          base.interventionAsk = String(j.interventionAsk ?? "").slice(0, 140) || "asked for something the AI cannot do";
          base.assistable = j.assistable !== false; // default assistable unless the model says otherwise
        }
        return base;
      } catch { /* fall through */ }
    }
  }
  // Heuristic fallback (no LLM). Deterministic needs_human cues are checked BEFORE the generic
  // price/question defaults so an asset/call/redirect request is never mislabeled "question".
  const t = text.toLowerCase();
  const price = (t.match(/\$\s?(\d[\d,]{1,6})/) || [])[1];
  const priceMentioned = price ? Number(price.replace(/,/g, "")) : null;
  if (/\b(unsubscribe|remove me|stop emailing|do not contact)\b/.test(t)) return { intent: "unsubscribe", priceMentioned, reason: "heuristic" };
  if (/\b(not interested|no thank|we don'?t|won'?t be able|pass\b|decline)\b/.test(t)) return { intent: "hard_no", priceMentioned, reason: "heuristic" };
  if (/out of office|auto(-| )?reply|automatic reply|do-not-reply|noreply/.test(t)) return { intent: "auto", priceMentioned, reason: "heuristic" };
  const hh = classifyInterventionHeuristic(t);
  if (hh) return { intent: "needs_human", priceMentioned, reason: "heuristic", interventionType: hh.type, interventionAsk: hh.ask, assistable: hh.assistable };
  if (priceMentioned) return { intent: "counter_offer", priceMentioned, reason: "heuristic" };
  if (/\?\s*$|how much|what.*cost|tell me more|can you/.test(t)) return { intent: "question", priceMentioned, reason: "heuristic" };
  return { intent: "interested", priceMentioned, reason: "heuristic" };
}

// Deterministic backstop for the needs_human categories when there is no LLM. Order = priority.
function classifyInterventionHeuristic(t: string): { type: InterventionType; ask: string; assistable: boolean } | null {
  const R: Array<[RegExp, InterventionType, string, boolean]> = [
    [/\b(call|zoom|google meet|g[- ]?meet|hop on|jump on|phone call|dial|ring you)\b/i, "sync_contact", "wants a call / video meeting", false],
    [/\b(whatsapp|telegram|\bsms\b|text me|signal app|dm me)\b/i, "other_channel", "wants to move to another channel", false],
    [/\b(nda|contract|agreement|msa|docusign|terms (and|&) conditions)\b/i, "legal_contract", "wants a contract / NDA signed", false],
    [/\b(invoice|purchase order|\bpo\b|\bw-?9\b|tax (form|id)|bank (details|account)|iban|swift|billing (details|info))\b/i, "payment_details", "wants invoice / PO / bank / tax details", true],
    [/\b(submit (via|through|using|our)|fill (out|in) (this|the) form|vendor portal|create an account|sign up|submission (system|portal)|apply (here|via))\b/i, "process_portal", "wants submission via a form/portal", false],
    [/(i(?:'ve| have) (left|moved on)|no longer (with|at)|contact (my|our)|reach out to|forward(ed)? (this|you) to|wrong person|not the right)/i, "redirect", "redirect to another contact", true],
    [/\b(one[- ]?pager|media[- ]?kit|rate[- ]?card|deck|slides?|presentation|case stud(y|ies)|portfolio|samples?|logo|hi[- ]?res|screenshots?|brand assets?|press photos?)\b/i, "asset_request", "asked for a document / assets", true],
    [/\b(linkedin|connect on li\b|your website|are you legit|company (registration|number)|references?)\b/i, "identity_verification", "wants LinkedIn / proof of legitimacy", true],
    [/\b(availabilit|calendly|cal\.com|book a (time|slot|call)|what times|your calendar)\b/i, "scheduling", "wants availability / a calendar link", true],
    [/\b(do-?follow|permanent|exclusiv|turnaround|monthly traffic|how (much|many) (traffic|visitors|readers)|dau|mau|editorial (policy|guidelines))\b/i, "factual_question", "factual question needing a real answer", true],
    [/\b(retainer|long[- ]?term|per month|ongoing|package|minimum (is|of))\b/i, "over_policy", "wants terms beyond our policy/ceiling", true],
    [/\b(attach(ed|ing)|see the (attached|doc)|find (attached|enclosed)|pfa)\b/i, "inbound_attachment", "sent a file for us to review", false],
  ];
  for (const [re, type, ask, assistable] of R) if (re.test(t)) return { type, ask, assistable };
  return null;
}

export interface ThreadMessage { from: "us" | "them"; body: string }

export interface DraftInput {
  settings: NegotiationSettings;
  thread: ThreadMessage[];   // full conversation, oldest first
  authorName: string;
  publication: string;
  ceiling: number | null;    // max we may offer this thread (from pricing tier / override); null = placement-only, no paid offer
  floor: number;             // never below this
  lastIntent: ReplyIntent;
  theirPrice?: number | null; // a $ figure they just named (from classification), if any
  senderName?: string;       // who signs the email
  assistInput?: string | null;    // human-provided real info (link/availability/fact/redirect) — safe to quote
  assistHasAttachment?: boolean;  // a real file is being attached to this send, so promising an attachment is truthful
}

export interface DraftResult {
  body: string;
  suggestedOffer: number | null;
  shouldStop: boolean;       // true = stop the thread (declined / done / over length)
  statusHint: "negotiating" | "agreed" | "declined" | "stalled";
  needsHuman?: boolean;             // post-generation guard tripped: route to a human instead of sending
  interventionType?: InterventionType;
  interventionAsk?: string;
}

// The draft must never PROMISE a capability the email agent lacks (attach a file, hop on a call,
// share a calendar/LinkedIn, quote a hard stat) unless the human actually supplied it. This regex
// is the last-line enforcement: if a generated body claims one of these and no assist input backs
// it, we discard the draft and route to a human rather than sending a hollow promise.
const FABRICATION_RE = /\b(attach(ed|ing|ment)?|enclosed|i(?:'ve| have|'ll| will) (attached|enclosed|sent|share[d]?|include[d]?)|one[- ]?pager|media[- ]?kit|deck|slide[- ]?deck|pitch deck|hop on|jump on|(schedule|set ?up|arrange) a (call|meeting|zoom)|calendar|calendly|cal\.com|linkedin|our (portfolio|case stud))/i;

// Draft the next negotiation reply, obeying the handbook, tone, thread-length limit, and the
// price floor/ceiling (with anti-highball behaviour). Returns null only if no LLM is available.
export async function draftNegotiationReply(input: DraftInput): Promise<DraftResult | null> {
  const { settings, thread, authorName, publication, ceiling, floor, lastIntent } = input;
  const first = (authorName || "there").trim().split(/\s+/)[0] || "there";
  const signer = input.senderName || "Abdullah";
  const usCount = thread.filter((m) => m.from === "us").length;
  const overLength = usCount >= settings.max_thread_length;

  if (lastIntent === "hard_no" || lastIntent === "unsubscribe") {
    return {
      body: sanitizeBody(`Hi ${first},\n\nTotally understand, thanks for letting me know and no worries at all. If anything changes down the line, my door is open. Wishing you well.\n\nBest,\n${signer}`),
      suggestedOffer: null, shouldStop: true, statusHint: "declined",
    };
  }

  // Close on acceptance: if they accepted a concrete price we can pay, take the deal at THAT
  // number. Lowballing happens while negotiating (counter_offer), not after a yes, so we never
  // talk ourselves out of a good deal. If their accepted price is above the ceiling, fall
  // through and let the model counter down instead of agreeing.
  const theirPrice = input.theirPrice ?? null;
  if (lastIntent === "accept" && theirPrice != null && theirPrice >= floor && (ceiling == null || theirPrice <= ceiling)) {
    return {
      // Promise only a text blurb the email can actually carry — never "assets"/attachments.
      body: sanitizeBody(`Hi ${first},\n\nPerfect, ${settings.currency} ${theirPrice} works. I'll follow up shortly with a short blurb and everything you need from our side. Thanks ${first}, glad to be included.\n\nBest,\n${signer}`),
      suggestedOffer: theirPrice, shouldStop: true, statusHint: "agreed",
    };
  }
  // Accepted our terms with no explicit number: close at our lowball opening (the least we would pay).
  if (lastIntent === "accept" && theirPrice == null && ceiling != null) {
    const openPctA = Math.min(100, Math.max(0, settings.opening_percent ?? 40));
    const closeAt = Math.max(floor, Math.round(floor + (ceiling - floor) * (openPctA / 100)));
    return {
      body: sanitizeBody(`Hi ${first},\n\nGreat, glad it works. I'll follow up shortly with a short blurb and everything you need from our side so you can add ImagineArt. Thanks ${first}.\n\nBest,\n${signer}`),
      suggestedOffer: closeAt, shouldStop: true, statusHint: "agreed",
    };
  }

  const convo = thread.map((m) => `${m.from === "us" ? "US" : publication.toUpperCase() || "THEM"}: ${m.body}`).join("\n\n===\n\n");
  const openPct = Math.min(100, Math.max(0, settings.opening_percent ?? 40));
  const opening = ceiling == null ? null : Math.max(floor, Math.round(floor + (ceiling - floor) * (openPct / 100)));
  const aggr = AGGRESSION[settings.aggressiveness] ?? AGGRESSION.balanced;
  const priceGuidance = ceiling == null
    ? `This site is below our paid tiers, so DO NOT offer money. Push for a free or editorial inclusion only (relevance, a useful tool for their readers, we can provide a short written blurb and quote text inline).`
    : `You may offer up to ${settings.currency} ${ceiling} MAXIMUM, never more. Open around ${settings.currency} ${opening} and move up only in small steps if they push back. Floor is ${settings.currency} ${floor}; never go below it. ${aggr} ${settings.anti_highball}`;

  const assist = input.assistInput?.trim();
  const assistBlock = assist
    ? `\nASSIST CONTEXT (human-provided, real, safe to quote verbatim): ${assist}\nUse it to answer the writer's request truthfully — include the link/detail/answer exactly as given.${input.assistHasAttachment ? " A real file IS attached to this email, so you MAY say it is attached." : ""}\n`
    : "";

  const out = await llm(
    `You are negotiating on behalf of ImagineArt via email. Write ONLY the next email body (a reply in an ongoing thread, so do not re-introduce yourself fully).

NEGOTIATION BRIEF (obey): ${settings.handbook}
TONE: ${settings.tone}
PRICING: ${priceGuidance}
${overLength ? "You have already sent several messages, so if there is no clear progress, say you will follow up and wind down rather than nagging (do NOT propose a call)." : ""}
${assistBlock}
HARD RULES:
- Start with "Hi ${first},". End with "Best,\\n${signer}".
- ${settings.style_rules}
- 2 to 5 sentences. Human, specific, not pushy.
- Never promise anything above the ${settings.currency} ${ceiling ?? 0} ceiling or below ${settings.currency} ${floor}.
- Never promise to attach or send a file (one-pager, deck, media kit, portfolio, samples, logo), share a LinkedIn or calendar link, schedule or join a call/meeting, or state a specific traffic/turnaround/exclusivity/do-follow fact, UNLESS that exact thing is provided in an ASSIST CONTEXT block above. If none is present and the writer is asking for any of these, do NOT answer the request — reply only about what you can, or keep it brief; the system will route it to a human.

CONVERSATION SO FAR:
${convo}

After the email, on a NEW last line, output exactly: <<META offer=NUMBER_OR_none status=negotiating|agreed|declined|stalled>>`,
    500, 0.5
  );
  if (!out) return null;

  let body = out;
  let suggestedOffer: number | null = null;
  let statusHint: DraftResult["statusHint"] = "negotiating";
  const meta = out.match(/<<META\s+offer=(\S+)\s+status=(\w+)\s*>>/i);
  if (meta) {
    body = out.slice(0, meta.index).trim();
    if (!/^none$/i.test(meta[1])) { const n = Number(meta[1].replace(/[^\d.]/g, "")); if (!isNaN(n)) suggestedOffer = n; }
    if (["negotiating", "agreed", "declined", "stalled"].includes(meta[2].toLowerCase())) statusHint = meta[2].toLowerCase() as any;
  }
  // Enforce the ceiling/floor even if the model drifts.
  if (suggestedOffer != null && ceiling != null) suggestedOffer = Math.min(suggestedOffer, ceiling);
  if (suggestedOffer != null) suggestedOffer = Math.max(suggestedOffer, floor);

  body = sanitizeBody(body);

  // Post-generation fabrication guard (defense in depth). If the model promised a capability the
  // email agent lacks and the human did NOT supply the backing input/attachment, discard this
  // draft and signal needs_human so run.ts routes it to a person instead of sending a hollow reply.
  if (!assist && !input.assistHasAttachment && FABRICATION_RE.test(body)) {
    return {
      body: "", suggestedOffer: null, shouldStop: true, statusHint: "stalled",
      needsHuman: true, interventionType: "other",
      interventionAsk: "reply would require an asset/call/link the AI cannot provide",
    };
  }

  return { body, suggestedOffer, shouldStop: statusHint === "declined" || statusHint === "agreed", statusHint };
}
