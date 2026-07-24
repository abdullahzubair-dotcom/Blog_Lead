// Guards against enriching/emailing things that aren't real people. Discovery sometimes
// extracts publication names, section labels, or role blurbs as "authors" — we don't want
// to find emails for those, nor attribute generic inboxes (contact@, tips@) to a person.

// Words that signal a company / publication / label / job title rather than a person's name.
const NON_PERSON_WORDS = new Set([
  "inc", "llc", "ltd", "corp", "gmbh", "co", "company", "group", "ventures", "labs",
  "technologies", "solutions", "systems", "services", "media", "news", "newsroom",
  "magazine", "journal", "review", "times", "post", "wire", "daily", "weekly", "report",
  "digest", "hub", "insider", "network", "press", "editorial", "staff", "team", "authors",
  "author", "contributor", "contributors", "guest", "admin", "editor", "editors", "desk",
  "video", "tv", "podcast", "blog", "official", "department", "director", "engineer",
  "manager", "platform", "requirements", "product", "marketing", "sales", "support",
  // job-title words that were slipping through as "names" (e.g. "Consultant and Applied scientist")
  "scientist", "consultant", "analyst", "specialist", "officer", "founder", "cofounder",
  "ceo", "cto", "cmo", "coo", "vp", "journalist", "reporter", "correspondent", "columnist",
  "freelance", "freelancer", "writer", "researcher", "strategist", "lead", "head", "applied",
  // scraper nav-junk tokens
  "navigation", "links",
]);

// Connector words a real name never contains, but a scraped title/phrase does
// ("Head of Content", "Consultant and Applied scientist", "Editor at CNET").
const TITLE_CONNECTOR = /\s(and|of|the|for|at|with|&)\s/i;

// Scraper junk that gets concatenated onto a byline ("...Social Links Navigation", "By ...").
const LEADING_JUNK = /^(by|written by|words by|author|posted by)[:\s]+/i;
const TRAILING_JUNK = /\s*(social links navigation|continue reading|read (more|full)|share (this)?|sign ?in|subscribe|view all posts|follow (us)?|leave a comment|newsletter|see all).*$/i;

import { isRoleEmail as isRoleEmailCanonical } from "@/lib/email/roleEmail";

// Normalize a scraped byline into a clean personal name (strip "By ", trailing nav junk, and a
// role word smushed onto the surname like "CaiContributor" -> "Cai"). Returns "" if nothing usable.
export function cleanAuthorName(raw?: string | null): string {
  let n = (raw ?? "").trim();
  if (!n) return "";
  n = n.replace(LEADING_JUNK, "").replace(TRAILING_JUNK, "");
  // "CatherineCaiContributor" / "Alistair CampbellEditor" → drop a role word fused onto a lowercase tail
  n = n.replace(/(?<=[a-z])(Contributor|Editor|Staff|Correspondent|Columnist|Reporter|Journalist|Writer)$/u, "");
  return n.replace(/\s+/g, " ").trim();
}

export function isLikelyPersonName(name: string, publication?: string): boolean {
  const n = cleanAuthorName(name);
  if (!n) return false;
  if (/\d/.test(n)) return false;               // digits → not a name
  if (/[,/|]/.test(n)) return false;            // commas/slashes → title or company
  if (TITLE_CONNECTOR.test(n)) return false;    // "and/of/the/at" → a title phrase, not a name
  const tokens = n.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false; // need first+last, not a blurb
  const lower = n.toLowerCase();
  for (const t of tokens) {
    if (NON_PERSON_WORDS.has(t.toLowerCase().replace(/[^a-z]/g, ""))) return false;
  }
  // matches the publication name → it's the outlet, not a person
  if (publication) {
    const pub = publication.toLowerCase();
    if (lower === pub || pub.includes(lower) || lower.includes(pub.replace(/\.(com|ai|org|net|io).*$/, ""))) return false;
  }
  return true;
}

// Delegate to the single canonical role-email detector (src/lib/email/roleEmail.ts) so the
// enrich/finder path and the storage/send path agree. The canonical version matches compound
// role addresses too (pressinquiries@, brandlicensing@, no-reply@…), which the old exact-token
// set here missed — letting pressinquiries@medium.com slip through as a "found" email.
export function isRoleEmail(email: string): boolean {
  return isRoleEmailCanonical(email);
}

// A "guess" = an email we CONSTRUCTED from a domain pattern (not SMTP-verified). Sourced
// emails (page/LinkedIn/Blitz/social/found-on-site) and pattern-verified are NOT guesses.
export function isGuessSource(source?: string | null): boolean {
  return source === "pattern" || source === "pattern-catchall";
}
