import { readLines, streamEventSchema, type StreamEvent } from '../../shared/stream.js';
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  sequence?: number;
};
export type Conversation = { id: string; title: string; updatedAt: number };
export type Turn = { id: string; state: string };
async function checkedFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  return response;
}
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await checkedFetch(url, init);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
export async function loadMessages(id: string, signal?: AbortSignal) {
  const messages: ChatMessage[] = [];
  let after = 0;
  while (true) {
    const page = await request<{ items: ChatMessage[]; hasMore: boolean }>(
      `/api/conversations/${id}/messages?limit=100&after=${after}`,
      { signal: signal ?? null },
    );
    messages.push(...page.items);
    if (!page.hasMore) return messages;
    const next = page.items.at(-1)?.sequence;
    if (!next || next <= after) throw new Error('Could not load conversation history.');
    after = next;
  }
}
export async function streamTurn(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void,
) {
  const response = await checkedFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
    headers: { Accept: 'application/x-ndjson' },
  });
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const turn = (await response.json()) as Turn;
    if (turn.state !== 'completed')
      throw new Error('This answer is already in progress. Reopen the conversation shortly.');
    return;
  }
  if (!response.body) throw new Error('No response stream received.');
  let completed = false;
  for await (const line of readLines(response.body)) {
    if (!line.trim()) continue;
    const event = streamEventSchema.parse(JSON.parse(line));
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'done') completed = true;
    onEvent(event);
  }
  if (!completed)
    throw new Error('The connection ended before the answer finished. You can retry.');
}
