import { expect, it } from 'vitest';
import { alignLinkedCitations } from '../../src/server/agent/citationLinks.js';
import type { SearchResult } from '../../src/server/agent/search.js';

const sources: SearchResult[] = [
  {
    id: 'S1',
    title: 'Summary',
    url: 'https://summary.example/pricing',
    excerpt: 'Summary',
    published: null,
    observedAt: '2026-11-13T00:00:00Z',
  },
  {
    id: 'S6',
    title: 'Official pricing',
    url: 'https://vendor.example/pricing?ref=search',
    excerpt: 'Official rate',
    published: null,
    observedAt: '2026-11-13T00:00:00Z',
  },
];

it('aligns a linked page with its actual source ID and drops unknown link citations', () => {
  expect(
    alignLinkedCitations(
      'See [official pricing](https://vendor.example/pricing) [S1] and [another page](https://other.example/) [S1].',
      sources,
    ),
  ).toBe(
    'See [official pricing](https://vendor.example/pricing) [S6] and [another page](https://other.example/).',
  );
});
