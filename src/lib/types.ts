export interface Domain {
  id: string;
  host: string;
  name?: string;
  cms_guess?: string;
  dr_proxy_score: number;
  country?: string;
  language?: string;
  first_seen: string;
  last_seen: string;
  created_at: string;
}

export interface Author {
  id: string;
  full_name: string;
  slug?: string;
  avatar_url?: string;
  bio?: string;
  role?: string;
  primary_domain_id?: string;
  same_as_json: string[];
  description?: string;
  source?: string;
  discarded?: boolean;
  safety_score?: number | null;
  safety_summary?: string | null;
  safety_checked_at?: string | null;
  created_at: string;
  updated_at: string;
  // joined
  domain?: Domain;
  contacts?: Contact[];
  articles?: Article[];
  score?: Score;
}

// One flagged post for an author's safety screening (NSFW / hate-violence-illegal /
// political-controversy). See src/lib/extract/safety.ts.
export interface FlaggedContent {
  id: string;
  author_id: string;
  article_id: string;
  category: "nsfw" | "hate_violence_illegal" | "political_controversy";
  severity: "low" | "medium" | "high";
  reason?: string;
  created_at: string;
  article?: { title?: string; url_canonical?: string };
}

export interface Article {
  id: string;
  url_canonical: string;
  title?: string;
  excerpt?: string;
  published_at?: string;
  lastmod?: string;
  lead_image_url?: string;
  domain_id?: string;
  archetype?: string;
  readability_text_excerpt?: string;
  source?: string;
  created_at: string;
  // joined
  domain?: Domain;
  authors?: Author[];
  mentions?: Mention[];
}

export interface Contact {
  id: string;
  author_id?: string;
  domain_id?: string;
  type: "mailto" | "form" | "author_page" | "twitter" | "linkedin" | "mastodon" | "youtube" | "instagram";
  value: string;
  confidence: number;
  source?: string;
  verified_syntax: boolean;
  created_at: string;
}

export interface Mention {
  id: string;
  article_id: string;
  tool_name: string;
  count: number;
}

export interface Score {
  id: string;
  author_id?: string;
  article_id?: string;
  relevance: number;
  freshness: number;
  authority: number;
  competitor_overlap: number;
  contact_confidence: number;
  composite: number;
  computed_at: string;
}

export interface DiscoveryHit {
  id: string;
  url: string;
  source: string;
  query?: string;
  title?: string;
  snippet?: string;
  discovered_at: string;
  processed: boolean;
}

export interface SeedTool {
  id: string;
  name: string;
  aliases: string[];
  enabled: boolean;
  category: "our_product" | "competitor" | "topic";
  created_at: string;
}

export interface HarvesterConfig {
  id: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface PipelineRun {
  id: string;
  started_at: string;
  finished_at?: string;
  stage?: string;
  status: "running" | "completed" | "failed";
  stats: Record<string, unknown>;
  error?: string;
}

export interface Suppression {
  id: string;
  type: "domain" | "author" | "url";
  value: string;
  reason?: string;
  added_at: string;
}

export interface RawHit {
  url: string;
  title?: string;
  snippet?: string;
  source: string;
  query?: string;
  discoveredAt: string;
}

export interface ProspectCard {
  author: Author;
  articles: Article[];
  contacts: Contact[];
  mentions: string[];
  score: Score | null;
  domain: Domain | null;
  flaggedContent?: FlaggedContent[];
}

export interface DashboardStats {
  totalProspects: number;
  totalAuthors: number;
  totalPublications: number;
  contactablePercent: number;
  newThisWeek: number;
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export interface Campaign {
  id: string;
  name: string;
  keywords: string[];
  region?: string;
  target_hits: number;
  status: "draft" | "running" | "done";
  created_at: string;
  author_count?: number;
  seed_writer_name?: string | null;
  seed_article_url?: string | null;
}

// ─── Workflows ────────────────────────────────────────────────────────────────

export type EmailStatusFilter = "any" | "has" | "verified" | "guessed" | "none" | "linkedin_no_email";

export interface WorkflowFilters {
  minScore?: number;
  archetype?: string;
  tool?: string;
  hasContact?: boolean;
  emailStatus?: EmailStatusFilter;
  notContacted?: boolean; // only authors not yet emailed/queued (respects manual override)
  region?: string;
  minArticles?: number;
  limit?: number;
  sortDir?: "asc" | "desc";
}

export interface Workflow {
  id: string;
  campaign_id?: string;
  name: string;
  filters: WorkflowFilters;
  status: "draft" | "running" | "ready";
  prospect_count?: number;
  created_at: string;
  campaign?: Pick<Campaign, "id" | "name">;
}

export interface WorkflowProspect {
  id: string;
  workflow_id: string;
  author_id: string;
  included: boolean;
  rank?: number;
  created_at: string;
  author?: Author;
  score?: Score | null;
  contacts?: Contact[];
  articles?: Article[];
  domain?: Domain | null;
}

// ─── Email Templates ──────────────────────────────────────────────────────────

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  guidance?: string; // optional writing direction for the AI {{custom_line}} opener
  channel?: "email" | "linkedin"; // which outreach channel this template is for (default email)
  created_at: string;
  updated_at: string;
}

// A generated LinkedIn connection note for one prospect (copy-paste, not sent).
export interface LinkedinMessage {
  id: string;
  workflow_id: string;
  author_id: string;
  template_id?: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

// ─── Outreach Emails ──────────────────────────────────────────────────────────

export interface OutreachEmail {
  id: string;
  workflow_id: string;
  author_id: string;
  template_id?: string;
  subject?: string;
  body?: string;
  status: "draft" | "ready" | "scheduled" | "sent" | "failed";
  scheduled_at?: string;
  sent_at?: string;
  error?: string;
  sender_email?: string | null;
  replied_at?: string | null;
  created_at: string;
  author?: Author;
}

// Per-user sending identity + schedule. Each logged-in user sends from their own Gmail.
export interface UserEmailConfig {
  user_email: string;
  from_name?: string;
  timezone: string;
  send_hour_start: number;
  send_hour_end: number;
  gap_minutes: number;
  daily_cap: number;
  hasPassword: boolean; // never expose the password itself to the client
}

export interface EmailSendConfig {
  id: string;
  workflow_id: string;
  timezone: string;
  send_hour_start: number;
  send_hour_end: number;
  gap_minutes: number;
  daily_cap: number;
  from_name?: string;
  from_email?: string;
  provider: "smtp" | "blitz";
  created_at: string;
}
