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
  | "hard_no" | "unsubscribe" | "auto" | "irrelevant";

export interface ReplyClassification {
  intent: ReplyIntent;
  priceMentioned: number | null; // a $ figure they named, if any
  reason: string;
}

// Classify an inbound reply so the AI knows how to respond (and so hard-no / unsubscribe /
// automated messages get pulled OUT of the negotiation queue). Falls back to a keyword
// heuristic when no LLM key is set — never throws.
export async function classifyReplyIntent(replyText: string, subject = ""): Promise<ReplyClassification> {
  const text = `${subject}\n${replyText}`.trim().slice(0, 4000);
  const out = await llm(
    `Classify this inbound reply to a media-outreach email. Return ONLY compact JSON:
{"intent": one of ["interested","counter_offer","accept","question","hard_no","unsubscribe","auto","irrelevant"], "priceMentioned": number or null, "reason": "<=12 words"}

Definitions:
- interested: open to featuring/including us, positive, wants to talk.
- counter_offer: names their own price or terms.
- accept: agrees to our proposal/price.
- question: needs info before deciding.
- hard_no: clearly declines / not interested / "we don't do this".
- unsubscribe: asks to stop emailing / remove them.
- auto: automated out-of-office / autoresponder / no-reply.
- irrelevant: spam or unrelated.

Reply:
"""${text}"""`,
    200, 0
  );
  if (out) {
    const m = out.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const j = JSON.parse(m[0]);
        const intent = ["interested", "counter_offer", "accept", "question", "hard_no", "unsubscribe", "auto", "irrelevant"].includes(j.intent) ? j.intent : "interested";
        const price = typeof j.priceMentioned === "number" ? j.priceMentioned : null;
        return { intent, priceMentioned: price, reason: String(j.reason ?? "").slice(0, 80) };
      } catch { /* fall through */ }
    }
  }
  // Heuristic fallback
  const t = text.toLowerCase();
  const price = (t.match(/\$\s?(\d[\d,]{1,6})/) || [])[1];
  const priceMentioned = price ? Number(price.replace(/,/g, "")) : null;
  let intent: ReplyIntent = "interested";
  if (/\b(unsubscribe|remove me|stop emailing|do not contact)\b/.test(t)) intent = "unsubscribe";
  else if (/\b(not interested|no thank|we don'?t|won'?t be able|pass\b|decline)\b/.test(t)) intent = "hard_no";
  else if (/out of office|auto(-| )?reply|automatic reply|do-not-reply|noreply/.test(t)) intent = "auto";
  else if (priceMentioned) intent = "counter_offer";
  else if (/\?\s*$|how much|what.*cost|tell me more|can you/.test(t)) intent = "question";
  return { intent, priceMentioned, reason: "heuristic" };
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
}

export interface DraftResult {
  body: string;
  suggestedOffer: number | null;
  shouldStop: boolean;       // true = stop the thread (declined / done / over length)
  statusHint: "negotiating" | "agreed" | "declined" | "stalled";
}

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
      body: sanitizeBody(`Hi ${first},\n\nPerfect, ${settings.currency} ${theirPrice} works. I will get the assets and a short blurb over to you shortly. Thanks ${first}, glad to be included.\n\nBest,\n${signer}`),
      suggestedOffer: theirPrice, shouldStop: true, statusHint: "agreed",
    };
  }
  // Accepted our terms with no explicit number: close at our lowball opening (the least we would pay).
  if (lastIntent === "accept" && theirPrice == null && ceiling != null) {
    const openPctA = Math.min(100, Math.max(0, settings.opening_percent ?? 40));
    const closeAt = Math.max(floor, Math.round(floor + (ceiling - floor) * (openPctA / 100)));
    return {
      body: sanitizeBody(`Hi ${first},\n\nGreat, glad it works. I will send the assets and a short blurb over shortly so you can add ImagineArt. Thanks ${first}.\n\nBest,\n${signer}`),
      suggestedOffer: closeAt, shouldStop: true, statusHint: "agreed",
    };
  }

  const convo = thread.map((m) => `${m.from === "us" ? "US" : publication.toUpperCase() || "THEM"}: ${m.body}`).join("\n\n===\n\n");
  const openPct = Math.min(100, Math.max(0, settings.opening_percent ?? 40));
  const opening = ceiling == null ? null : Math.max(floor, Math.round(floor + (ceiling - floor) * (openPct / 100)));
  const aggr = AGGRESSION[settings.aggressiveness] ?? AGGRESSION.balanced;
  const priceGuidance = ceiling == null
    ? `This site is below our paid tiers, so DO NOT offer money. Push for a free or editorial inclusion only (relevance, a useful tool for their readers, we can supply assets and quotes).`
    : `You may offer up to ${settings.currency} ${ceiling} MAXIMUM, never more. Open around ${settings.currency} ${opening} and move up only in small steps if they push back. Floor is ${settings.currency} ${floor}; never go below it. ${aggr} ${settings.anti_highball}`;

  const out = await llm(
    `You are negotiating on behalf of ImagineArt via email. Write ONLY the next email body (a reply in an ongoing thread, so do not re-introduce yourself fully).

NEGOTIATION BRIEF (obey): ${settings.handbook}
TONE: ${settings.tone}
PRICING: ${priceGuidance}
${overLength ? "You have already sent several messages, so if there is no clear progress, politely propose a quick call or say you will follow up, and wind down rather than nagging." : ""}

HARD RULES:
- Start with "Hi ${first},". End with "Best,\\n${signer}".
- ${settings.style_rules}
- 2 to 5 sentences. Human, specific, not pushy.
- Never promise anything above the ${settings.currency} ${ceiling ?? 0} ceiling or below ${settings.currency} ${floor}.

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

  return { body: sanitizeBody(body), suggestedOffer, shouldStop: statusHint === "declined" || statusHint === "agreed", statusHint };
}
