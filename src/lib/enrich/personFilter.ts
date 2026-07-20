// Guards against enriching/emailing things that aren't real people. Discovery sometimes
// extracts publication names, section labels, or role blurbs as "authors" — we don't want
// to find emails for those, nor attribute generic inboxes (contact@, tips@) to a person.

// Words that signal a company / publication / label rather than a person's name.
const NON_PERSON_WORDS = new Set([
  "inc", "llc", "ltd", "corp", "gmbh", "co", "company", "group", "ventures", "labs",
  "technologies", "solutions", "systems", "services", "media", "news", "newsroom",
  "magazine", "journal", "review", "times", "post", "wire", "daily", "weekly", "report",
  "digest", "hub", "insider", "network", "press", "editorial", "staff", "team", "authors",
  "author", "contributor", "contributors", "guest", "admin", "editor", "editors", "desk",
  "video", "tv", "podcast", "blog", "official", "department", "director", "engineer",
  "manager", "platform", "requirements", "product", "marketing", "sales", "support",
]);

import { isRoleEmail as isRoleEmailCanonical } from "@/lib/email/roleEmail";

export function isLikelyPersonName(name: string, publication?: string): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  if (/\d/.test(n)) return false;               // digits → not a name
  if (/[,/|]/.test(n)) return false;            // commas/slashes → title or company
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
