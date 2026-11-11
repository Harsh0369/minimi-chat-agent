import { afterEach, expect, it, vi } from 'vitest';
import { cosine, semanticRecall } from '../../src/server/agent/semantic.js';
afterEach(() => vi.unstubAllGlobals());
it('ranks paraphrase candidates, normalizes vectors and reuses embeddings', async () => {
  expect(cosine([2, 0], [3, 0])).toBe(1);
  const fetcher = vi.fn(async () =>
    Response.json({
      embeddings: [
        { values: [1, ...Array<number>(767).fill(0)] },
        { values: [1, ...Array<number>(767).fill(0)] },
        { values: [0, 1, ...Array<number>(766).fill(0)] },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const records = [
    { id: 'db', text: 'fixture managed database' },
    { id: 'crm', text: 'fixture sales tracking' },
  ];
  const args = [
    'key',
    'gemini-embedding-001',
    'fixture relational storage',
    records,
    new AbortController().signal,
  ] as const;
  expect((await semanticRecall(...args))[0]?.id).toBe('db');
  await semanticRecall(...args);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
