import { registrableDomain } from "./domain";

// Video / social / audio platforms that are NOT blog posts or articles. We only want
// written editorial content (author writes a piece → we can pitch them), so URLs on these
// platforms are dropped at ingest and skipped at profiling. Matched by registrable domain,
// so subdomains (m.youtube.com, open.spotify.com) are covered too.
const BLOCKED_DOMAINS = new Set([
  "youtube.com", "youtu.be",
  "vimeo.com", "dailymotion.com", "twitch.tv",
  "tiktok.com",
  "instagram.com",
  "facebook.com", "fb.com", "fb.watch",
  "twitter.com", "x.com", "t.co",
  "threads.net",
  "reddit.com", "redd.it",
  "pinterest.com",
  "snapchat.com",
  "spotify.com", "soundcloud.com",
  "podcasts.apple.com", "apple.co",
  "flipboard.com",
]);

// Exact hosts to block (not whole registrable domains). news.google.com serves opaque
// redirect wrappers, not fetchable articles — profiling them yields no author, so drop them
// (blocking by host avoids nuking legit google.com content like developers/cloud blogs).
const BLOCKED_HOSTS = new Set([
  "news.google.com",
  "google.com", "www.google.com",       // search/redirect pages, not articles
  "play.google.com", "books.google.com",
]);

// True if this URL is a video/social/audio platform, an aggregator/redirect wrapper, or
// otherwise unfit to profile as editorial content.
export function isBlockedUrl(url: string): boolean {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return true; } // unparseable → skip
  const bare = host.replace(/^www\./, "");
  return BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(bare) || BLOCKED_DOMAINS.has(registrableDomain(host));
}
