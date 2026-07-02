export interface ExtractedMeta {
  title?: string;
  author?: string;
  authorUrl?: string;
  publishedAt?: string;
  description?: string;
  image?: string;
  publisher?: string;
  canonicalUrl?: string;
}

function attr(html: string, pattern: RegExp): string | undefined {
  return html.match(pattern)?.[1]?.trim() || undefined;
}

function decode(s?: string): string | undefined {
  return s?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

export function extractMetadata(html: string, url: string): ExtractedMeta {
  const meta: ExtractedMeta = {};

  // 1. JSON-LD
  const jsonldBlocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of jsonldBlocks) {
    try {
      const obj = JSON.parse(block[1]);
      const items = Array.isArray(obj) ? obj : [obj];
      for (const item of items) {
        if (!meta.title && item.headline) meta.title = item.headline;
        if (!meta.publishedAt && (item.datePublished || item.dateModified)) {
          meta.publishedAt = item.datePublished ?? item.dateModified;
        }
        if (!meta.image && item.image) {
          meta.image = typeof item.image === "string" ? item.image : item.image?.url ?? item.image?.contentUrl;
        }
        if (!meta.description && item.description) meta.description = item.description;
        if (!meta.publisher && item.publisher?.name) meta.publisher = item.publisher.name;
        if (!meta.author && item.author) {
          const a = Array.isArray(item.author) ? item.author[0] : item.author;
          meta.author = a?.name ?? a;
          meta.authorUrl = a?.url ?? a?.sameAs;
        }
        if (!meta.canonicalUrl && item.url) meta.canonicalUrl = item.url;
      }
    } catch {}
  }

  // 2. OpenGraph
  if (!meta.title) meta.title = decode(attr(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i));
  if (!meta.image) meta.image = attr(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
  if (!meta.description) meta.description = decode(attr(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i));
  if (!meta.publisher) meta.publisher = attr(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i);
  if (!meta.canonicalUrl) meta.canonicalUrl = attr(html, /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)/i);

  // 3. Twitter Card
  if (!meta.title) meta.title = decode(attr(html, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)/i));
  if (!meta.image) meta.image = attr(html, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i);

  // 4. Standard HTML meta
  if (!meta.title) {
    meta.title = decode(attr(html, /<title[^>]*>([^<]+)<\/title>/i));
  }
  if (!meta.description) {
    meta.description = decode(attr(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i));
  }
  if (!meta.author) {
    meta.author = decode(attr(html, /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)/i));
  }
  if (!meta.publishedAt) {
    meta.publishedAt =
      attr(html, /<meta[^>]+(?:name|property)=["'](?:article:published_time|pubdate)["'][^>]+content=["']([^"']+)/i) ??
      attr(html, /<time[^>]+datetime=["']([^"']+)/i);
  }
  if (!meta.canonicalUrl) {
    meta.canonicalUrl = attr(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i);
  }

  return meta;
}
