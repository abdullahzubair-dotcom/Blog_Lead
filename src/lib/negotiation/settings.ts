import { supabaseAdmin } from "@/lib/db/supabase";

// A pricing tier: the max we'll offer a site that meets these thresholds. Thresholds left
// blank (or 0) don't constrain. UNVERIFIED metrics (null traffic/US-share, because we're on
// the free Ahrefs plan) do NOT fail a threshold — consistent with qualifyProspect — so DR-based
// tiers apply today and tighten automatically once a paid traffic source is connected.
export interface PricingRule {
  min_dr?: number;
  min_traffic?: number;
  min_us_share?: number;
  max_offer: number;
  label?: string;
}

export type Aggressiveness = "gentle" | "balanced" | "firm";

export interface NegotiationSettings {
  ai_autonomy: boolean;       // false = AI drafts for human approval; true = AI sends on its own
  handbook: string;           // the negotiation brief / criteria the model follows
  tone: string;
  aggressiveness: Aggressiveness; // how hard/fast the AI pushes and concedes
  opening_percent: number;    // where in [floor..ceiling] the AI opens (e.g. 40 = 40%)
  style_rules: string;        // hard writing rules for every generated email (e.g. no em dashes)
  max_thread_length: number;  // max AI messages in a thread before it escalates to a human
  min_price: number;          // floor: never offer/accept below this
  currency: string;
  anti_highball: string;
  pricing_rules: PricingRule[];
  updated_at?: string;
}

export const DEFAULT_NEGOTIATION_SETTINGS: NegotiationSettings = {
  ai_autonomy: false,
  handbook:
    "Goal: get ImagineArt (an AI image/video generation tool) featured or included in the writer's article, roundup, or list. " +
    "ALWAYS aim to pay the LEAST possible. Prefer a free or editorial inclusion, and only offer money if they clearly require it. " +
    "When you do offer, open LOW, concede slowly in small steps, and never jump to the tier ceiling (that is a hard cap, not a target). " +
    "Be genuinely helpful and specific about why ImagineArt fits their coverage. Keep it human and short. If they clearly decline, thank them and stop.",
  tone: "Warm, concise, human, professional. Never pushy or robotic.",
  aggressiveness: "firm",
  opening_percent: 20,
  style_rules: "Plain text only. Never use em dashes or en dashes; use commas or periods instead. No bracketed placeholders. Keep it short and human.",
  max_thread_length: 4,
  min_price: 0,
  currency: "USD",
  anti_highball:
    "If they open very high, do not anchor to it. Acknowledge, restate our value, come back near our tier ceiling, and move in small steps.",
  pricing_rules: [{ min_dr: 50, min_traffic: 10000, min_us_share: 50, max_offer: 150, label: "DR 50+ & 10k US traffic" }],
};

function parseRules(raw: any): PricingRule[] {
  if (!raw) return DEFAULT_NEGOTIATION_SETTINGS.pricing_rules;
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.filter((r) => typeof r?.max_offer === "number") : DEFAULT_NEGOTIATION_SETTINGS.pricing_rules;
  } catch {
    return DEFAULT_NEGOTIATION_SETTINGS.pricing_rules;
  }
}

export async function getNegotiationSettings(): Promise<NegotiationSettings> {
  const { data } = await supabaseAdmin.from("negotiation_settings").select("*").eq("id", true).maybeSingle();
  if (!data) return DEFAULT_NEGOTIATION_SETTINGS;
  return {
    ...DEFAULT_NEGOTIATION_SETTINGS,
    ...data,
    pricing_rules: parseRules(data.pricing_rules),
  };
}

export async function saveNegotiationSettings(patch: Partial<NegotiationSettings>): Promise<NegotiationSettings> {
  const row: any = { id: true, updated_at: new Date().toISOString() };
  for (const k of ["ai_autonomy", "handbook", "tone", "aggressiveness", "opening_percent", "style_rules", "max_thread_length", "min_price", "currency", "anti_highball"] as const) {
    if (patch[k] !== undefined) row[k] = patch[k];
  }
  if (patch.pricing_rules !== undefined) row.pricing_rules = JSON.stringify(patch.pricing_rules);
  await supabaseAdmin.from("negotiation_settings").upsert(row, { onConflict: "id" });
  return getNegotiationSettings();
}
