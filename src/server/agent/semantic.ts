import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readBoundedJson } from './readJson.js';

// Rebuildable, bounded process cache contains hashes and vectors, never message text.
const cache = new Map<string, number[]>();
const schema = z.object({
  embeddings: z.array(z.object({ values: z.array(z.number().finite()).length(768) })),
});
export function cosine(a: number[], b: number[]) {
  const dot = a.reduce((sum, n, i) => sum + n * (b[i] ?? 0), 0);
  return dot / (Math.hypot(...a) * Math.hypot(...b) || 1);
}
export async function semanticRecall<T extends { id: string; text: string }>(
  key: string,
  model: string,
  question: string,
  records: T[],
  signal: AbortSignal,
): Promise<T[]> {
  if (!records.length) return [];
  const inputs = [
    { text: question.slice(0, 4000), task: 'RETRIEVAL_QUERY' },
    ...records
      .slice(0, 80)
      .map((row) => ({ text: row.text.slice(0, 4000), task: 'RETRIEVAL_DOCUMENT' })),
  ];
  const hashes = inputs.map((item) =>
    createHash('sha256')
      .update(JSON.stringify([model, item]))
      .digest('hex'),
  );
  const missing = inputs
    .map((item, i) => ({ item, hash: hashes[i]! }))
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
            content: { parts: [{ text: item.text }] },
            taskType: item.task,
            outputDimensionality: 768,
          })),
        }),
      },
    );
    if (!response.ok) throw new Error(`EMBEDDING_${response.status}`);
    const data = schema.parse(await readBoundedJson(response, 4_000_000));
    if (data.embeddings.length !== missing.length) throw new Error('INVALID_EMBEDDING_COUNT');
    missing.forEach((row, i) => cache.set(row.hash, data.embeddings[i]!.values));
  }
  const query = cache.get(hashes[0]!)!;
  const ranked = records
    .slice(0, 80)
    .map((row, i) => ({ row, score: cosine(query, cache.get(hashes[i + 1]!)!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.row);
  while (cache.size > 512) cache.delete(cache.keys().next().value!);
  return ranked;
}
