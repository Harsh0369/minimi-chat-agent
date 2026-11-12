import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { StorePort } from '../storage/client.js';
import { readBoundedJson } from './readJson.js';

// Rebuildable process cache contains hashes and vectors, never message text.
const cache = new Map<string, number[]>();
const schema = z.object({
  embeddings: z.array(z.object({ values: z.array(z.number().finite()).length(768) })),
});
type Input = { text: string; task: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' };

export function cosine(a: number[], b: number[]) {
  const dot = a.reduce((sum, n, i) => sum + n * (b[i] ?? 0), 0);
  return dot / (Math.hypot(...a) * Math.hypot(...b) || 1);
}

async function embedItems(key: string, model: string, inputs: Input[], signal: AbortSignal) {
  const hashes = inputs.map((item) =>
    createHash('sha256')
      .update(JSON.stringify([model, item]))
      .digest('hex'),
  );
  const missing = inputs
    .map((item, index) => ({ item, hash: hashes[index]! }))
    .filter((row) => !cache.has(row.hash));
  if (missing.length) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal,
        body: JSON.stringify({
          requests: missing.map(({ item }) => ({
            model: `models/${model}`,
            content: { parts: [{ text: item.text.slice(0, 4000) }] },
            taskType: item.task,
            outputDimensionality: 768,
          })),
        }),
      },
    );
    if (!response.ok) throw new Error(`EMBEDDING_${response.status}`);
    const data = schema.parse(await readBoundedJson(response, 4_000_000));
    if (data.embeddings.length !== missing.length) throw new Error('INVALID_EMBEDDING_COUNT');
    missing.forEach((row, index) => cache.set(row.hash, data.embeddings[index]!.values));
  }
  while (cache.size > 512) cache.delete(cache.keys().next().value!);
  return hashes.map((hash) => cache.get(hash)!);
}

export async function indexPendingMemory(
  key: string,
  model: string,
  store: StorePort,
  ownerId: string,
  signal: AbortSignal,
) {
  const pending = await store.call('pendingEmbeddingTexts', ownerId, model, 40);
  if (!pending.length) return 0;
  const vectors = await embedItems(
    key,
    model,
    pending.map((row) => ({ text: row.text, task: 'RETRIEVAL_DOCUMENT' })),
    signal,
  );
  return store.call(
    'saveEmbeddings',
    ownerId,
    model,
    pending.map((row, index) => ({ id: row.id, vector: vectors[index]! })),
  );
}

export async function embedQuery(key: string, model: string, text: string, signal: AbortSignal) {
  return (await embedItems(key, model, [{ text, task: 'RETRIEVAL_QUERY' }], signal))[0]!;
}

export async function semanticRecall<T extends { id: string; text: string }>(
  key: string,
  model: string,
  question: string,
  records: T[],
  signal: AbortSignal,
): Promise<T[]> {
  if (!records.length) return [];
  const vectors = await embedItems(
    key,
    model,
    [
      { text: question, task: 'RETRIEVAL_QUERY' },
      ...records
        .slice(0, 80)
        .map((row) => ({ text: row.text, task: 'RETRIEVAL_DOCUMENT' as const })),
    ],
    signal,
  );
  const query = vectors[0]!;
  return records
    .slice(0, 80)
    .map((row, index) => ({ row, score: cosine(query, vectors[index + 1]!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.row);
}
