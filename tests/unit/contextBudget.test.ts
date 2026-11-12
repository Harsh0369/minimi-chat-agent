import { describe, expect, it } from 'vitest';
import { packMemorySections, selectSearchResults } from '../../src/server/agent/contextBudget.js';

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
    expect(selectSearchResults(sources, 'groq', false)).toHaveLength(2);
    expect(selectSearchResults(sources, 'groq', true)[0]?.excerpt).toHaveLength(300);
    expect(selectSearchResults(sources, 'gemini', true)).toHaveLength(5);
  });
});
