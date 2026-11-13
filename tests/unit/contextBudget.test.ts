import { describe, expect, it } from 'vitest';
import {
  packMemorySections,
  rankSearchResults,
  selectSearchResults,
} from '../../src/server/agent/contextBudget.js';

const record = (id: string, text: string) => ({
  id,
  text,
  role: 'user',
  createdAt: 0,
  timezone: 'UTC',
  conversationTitle: 'Test',
});

describe('provider context budgets', () => {
  it('keeps the active thread first and bounds Groq memory bytes', () => {
    const thread = Array.from({ length: 20 }, (_, index) =>
      record(`thread-${index}`, `message ${index}: ${'x'.repeat(1200)}`),
    );
    const packed = packMemorySections(
      [],
      [record('old', 'older cross-chat memory')],
      thread,
      'groq',
    );
    expect(packed.thread).toContain('thread-19');
    expect(packed.truncated).toBe(true);
    expect(Buffer.byteLength(packed.thread + packed.relevant + packed.dated)).toBeLessThanOrEqual(
      6_000,
    );
  });

  it('prioritizes exact-day records and avoids duplicating them', () => {
    const dated = [record('dated', 'Exact historical question')];
    const packed = packMemorySections(dated, dated, dated, 'groq');
    expect(packed.dated).toContain('Exact historical question');
    expect(packed.thread).toBe('');
    expect(packed.relevant).toBe('');
  });

  it('bounds Groq evidence without changing Gemini evidence', () => {
    const sources = Array.from({ length: 5 }, (_, index) => ({
      id: `S${index + 1}`,
      title: 'Official source',
      url: 'https://example.com',
      excerpt: 'x'.repeat(800),
      published: null,
      observedAt: '2026-11-12T00:00:00Z',
    }));
    expect(selectSearchResults(sources, 'groq', true)).toHaveLength(1);
    expect(selectSearchResults(sources, 'groq', false)).toHaveLength(3);
    expect(selectSearchResults(sources, 'groq', true)[0]?.excerpt).toHaveLength(260);
    expect(selectSearchResults(sources, 'gemini', true)).toHaveLength(5);
  });

  it('keeps a relevant primary source when a bounded provider receives summaries first', () => {
    const sources = [
      'https://example.net/blog/neon-pricing',
      'https://reviews.example.org/neon',
      'https://database-news.example/pricing',
      'https://neon.com/docs/introduction/plans',
      'https://another.example/neon',
    ].map((url, index) => ({
      id: `S${index + 1}`,
      title: index === 3 ? 'Neon plans' : 'Neon pricing guide',
      url,
      excerpt: 'Launch is billed by usage.',
      published: null,
      observedAt: '2026-11-12T00:00:00Z',
    }));
    const ranked = rankSearchResults(sources, 'Neon Launch plan pricing');
    expect(ranked[0]?.url).toBe('https://neon.com/docs/introduction/plans');
    expect(selectSearchResults(ranked, 'groq', false)).toContainEqual(sources[3]);
    expect(rankSearchResults(sources, 'unrelated question')).toEqual(sources);
  });

  it('keeps a requested plan price when it occurs after the leading snippet window', () => {
    const source = {
      id: 'S1',
      title: 'Plan pricing',
      url: 'https://vendor.example/pricing',
      excerpt: `${'Compute usage explanation. '.repeat(15)}Launch plan: $0.106 per CU-hour.`,
      published: null,
      observedAt: '2026-11-12T00:00:00Z',
    };
    const selected = selectSearchResults([source], 'groq', false, 'Launch plan price');
    expect(selected[0]?.excerpt).toContain('Launch plan: $0.106 per CU-hour');
    expect(Buffer.byteLength(selected[0]!.excerpt)).toBeLessThanOrEqual(260);
    expect(selectSearchResults([source], 'gemini', false, 'Launch plan price')[0]?.excerpt).toBe(
      source.excerpt,
    );
  });
});
