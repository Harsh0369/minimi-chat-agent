import { afterEach, expect, it, vi } from 'vitest';
import { cosine, indexPendingMemory, semanticRecall } from '../../src/server/agent/semantic.js';
import type { StorePort } from '../../src/server/storage/client.js';
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
it('indexes original older messages in SQLite-sized batches when embeddings are enabled', async () => {
  const calls: Array<{ operation: string; args: unknown[] }> = [];
  const store = {
    available: true,
    call: async (operation: string, ...args: unknown[]) => {
      calls.push({ operation, args });
      if (operation === 'pendingEmbeddingTexts')
        return [{ id: 'old-message', text: 'An older paraphrased discussion' }];
      if (operation === 'saveEmbeddings') return 1;
      throw new Error('Unexpected operation');
    },
  } as StorePort;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ embeddings: [{ values: [1, ...Array<number>(767).fill(0)] }] }),
    ),
  );
  expect(
    await indexPendingMemory(
      'key',
      'gemini-embedding-001',
      store,
      'owner',
      new AbortController().signal,
    ),
  ).toBe(1);
  expect(calls[1]).toMatchObject({
    operation: 'saveEmbeddings',
    args: ['owner', 'gemini-embedding-001', [{ id: 'old-message' }]],
  });
});
