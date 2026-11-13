import type { SearchResult } from './search.js';

function linkIdentity(value: string) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

// A model can print the right URL beside the wrong source ID. Keep the link,
// but only attach a citation for the same page among actual search results.
export function alignLinkedCitations(text: string, sources: SearchResult[]) {
  const byPage = new Map(sources.map((source) => [linkIdentity(source.url), source.id]));
  return text.replace(
    /(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))\s*\[(S\d+)\]/g,
    (_match, link: string, url: string, _citedId: string) => {
      const matchingId = byPage.get(linkIdentity(url));
      return matchingId ? `${link} [${matchingId}]` : link;
    },
  );
}
