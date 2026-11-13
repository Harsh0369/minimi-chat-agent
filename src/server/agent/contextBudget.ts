import type { Config } from '../config.js';
import type { SearchResult } from './search.js';

export type MemoryRecord = {
  id: string;
  role: string;
  text: string;
  createdAt: number;
  timezone: string;
  conversationTitle: string;
};

// Byte limits are conservative proxies for tokens across different model APIs.
// Provider tokenization and the output of later model calls still vary.
const MEMORY_BYTES: Record<Config['modelProvider'], number> = {
  gemini: 24_000,
  openai: 24_000,
  groq: 6_000,
};

function sliceBytes(text: string, limit: number) {
  let bytes = 0;
  let result = '';
  for (const char of text) {
    const size = Buffer.byteLength(char);
    if (bytes + size > limit) break;
    result += char;
    bytes += size;
  }
  return result;
}

const genericSearchTerms = new Set([
  'about',
  'and',
  'are',
  'best',
  'check',
  'current',
  'for',
  'from',
  'how',
  'latest',
  'official',
  'plan',
  'plans',
  'price',
  'prices',
  'pricing',
  'recent',
  'release',
  'released',
  'site',
  'the',
  'today',
  'what',
  'when',
  'which',
  'with',
]);

// Prefer a primary site when its domain matches a distinctive query term.
// Search order is the tie-breaker; a broad domain cannot win by merely saying "official" in its title.
export function rankSearchResults(results: SearchResult[], query: string) {
  const terms = [...new Set(query.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [])].filter(
    (term) => !genericSearchTerms.has(term),
  );
  const pricing = /\b(pric(?:e|es|ing)|cost|billing|plans?)\b/i.test(query);
  const release = /\b(releas(?:e|ed|es)|changelog|updates?|shipped)\b/i.test(query);
  return results
    .map((source, index) => {
      let score = 0;
      try {
        const url = new URL(source.url);
        const labels = url.hostname.toLowerCase().split('.');
        if (terms.some((term) => labels.includes(term))) score += 12;
        const path = url.pathname.toLowerCase();
        if (pricing && /\b(pricing|plans|billing)\b/.test(path)) score += 2;
        if (release && /\b(changelog|release|releases|updates)\b/.test(path)) score += 2;
      } catch {
        // Malformed URLs retain their original order and do not gain a relevance boost.
      }
      const title = source.title.toLowerCase();
      score += Math.min(2, terms.filter((term) => title.includes(term)).length);
      return { source, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ source }) => source);
}

function relevantExcerpt(text: string, query: string, limit: number) {
  if (!/\b(pric(?:e|es|ing)|cost|billing|plans?)\b/i.test(query)) return sliceBytes(text, limit);
  const terms = (query.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
    (term) => !genericSearchTerms.has(term),
  );
  const amounts = [...text.matchAll(/[$₹€£]\s*\d[\d,.]*/g)];
  const preferred = amounts.find((match) => {
    const position = match.index ?? 0;
    const nearby = text.slice(Math.max(0, position - 120), position).toLowerCase();
    return terms.some((term) => nearby.includes(term));
  });
  const position = preferred?.index;
  if (position === undefined || position < 100) return sliceBytes(text, limit);
  return sliceBytes(text.slice(position - 100).trimStart(), limit);
}

export function packMemorySections(
  dated: MemoryRecord[],
  relevant: MemoryRecord[],
  thread: MemoryRecord[],
  provider: Config['modelProvider'],
) {
  let remaining = MEMORY_BYTES[provider];
  let truncated = false;
  const seen = new Set<string>();
  const output = { dated: [] as string[], relevant: [] as string[], thread: [] as string[] };
  const sections: Array<[keyof typeof output, MemoryRecord[]]> = dated.length
    ? [
        ['dated', dated],
        ['thread', [...thread].reverse()],
        ['relevant', relevant],
      ]
    : [
        ['thread', [...thread].reverse()],
        ['relevant', relevant],
      ];
  for (const [section, rows] of sections) {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const header = `[${row.id}] ${new Date(row.createdAt).toISOString()} (${row.timezone}; ${row.conversationTitle}; ${row.role}): `;
      const overhead = Buffer.byteLength(header) + 1;
      if (remaining <= overhead + 80) {
        truncated = true;
        continue;
      }
      const available = Math.min(remaining - overhead, provider === 'groq' ? 1_200 : 3_000);
      const body = sliceBytes(row.text, available);
      const line = header + body + (body.length < row.text.length ? ' [truncated]' : '');
      const size = Buffer.byteLength(line) + 1;
      if (size > remaining) {
        truncated = true;
        continue;
      }
      output[section].push(line);
      remaining -= size;
      if (body.length < row.text.length) truncated = true;
    }
  }
  return {
    dated: output.dated.join('\n'),
    relevant: output.relevant.join('\n'),
    thread: output.thread.reverse().join('\n'),
    truncated,
  };
}

export function selectSearchResults(
  results: SearchResult[],
  provider: Config['modelProvider'],
  prefetched: boolean,
  query = '',
) {
  if (provider !== 'groq') return results;
  return results.slice(0, prefetched ? 1 : 3).map((source) => ({
    ...source,
    excerpt: relevantExcerpt(source.excerpt, query, 260),
  }));
}
