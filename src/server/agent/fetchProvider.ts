import { setTimeout as delay } from 'node:timers/promises';
export async function fetchProvider(url: string, options: RequestInit & { signal: AbortSignal }) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, options);
    if (attempt || ![429, 502, 503, 504].includes(response.status)) return response;
    const retryAfter = Number(response.headers.get('retry-after') ?? '0');
    if (retryAfter > 2) return response;
    await response.body?.cancel();
    await delay(Math.max(500 + Math.random() * 250, retryAfter * 1000), undefined, {
      signal: options.signal,
    });
  }
}
