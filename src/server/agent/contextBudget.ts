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
) {
  if (provider !== 'groq') return results;
  return results.slice(0, prefetched ? 1 : 2).map((source) => ({
    ...source,
    excerpt: sliceBytes(source.excerpt, 300),
  }));
}
