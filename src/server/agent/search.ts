import { z } from 'zod';
import { readBoundedJson } from './readJson.js';
import { log } from '../logger.js';

const resultSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.url(),
        content: z.string().default(''),
        published_date: z.string().nullable().optional(),
      }),
    )
    .default([]),
});
export type SearchResult = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  published: string | null;
  observedAt: string;
};
export async function webSearch(
  key: string,
  query: string,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const started = performance.now();
  let outcome: 'ok' | 'error' = 'error';
  let resultCount = 0;
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query: query.slice(0, 250),
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
        include_published_date: true,
      }),
      signal,
    });
    if (!response.ok) throw new Error(`SEARCH_${response.status}`);
    const data = resultSchema.parse(await readBoundedJson(response, 1_000_000));
    const results = data.results
      .filter((item) => {
        try {
          const url = new URL(item.url);
          return url.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname);
        } catch {
          return false;
        }
      })
      .map((item, index) => ({
        id: `S${index + 1}`,
        title: item.title.slice(0, 180),
        url: item.url,
        excerpt: item.content.slice(0, 800),
        published: item.published_date ?? null,
        observedAt: new Date().toISOString(),
      }));
    resultCount = results.length;
    outcome = 'ok';
    return results;
  } finally {
    if (process.env.PERF_LOG === '1')
      log({
        event: 'web_search_timing',
        elapsedMs: Math.round(performance.now() - started),
        outcome,
        resultCount,
      });
  }
}
