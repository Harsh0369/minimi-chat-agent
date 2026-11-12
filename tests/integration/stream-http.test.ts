import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApi, finishApp } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import { createStore } from '../../src/server/storage/store.js';
import type { StorePort } from '../../src/server/storage/client.js';
import { readLines } from '../../src/shared/stream.js';
let server: Server;
let store: ReturnType<typeof createStore>;
let origin: string, cookie: string, conversation: string;
const realFetch = globalThis.fetch;
const encoder = new TextEncoder();
const event = (text: string, finish = false) =>
  encoder.encode(
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...(finish ? { finishReason: 'STOP' } : {}) }] })}\n\n`,
  );
const routeResponse = Response.json({
  candidates: [
    { content: { parts: [{ text: '{"scope":"THREAD","needsClock":false,"clockZones":[]}' }] } },
  ],
});
const isRouter = (init: RequestInit) => !JSON.parse(String(init.body)).tools;
function api(path: string, body?: unknown, session = cookie, stream = false, signal?: AbortSignal) {
  return realFetch(origin + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      Cookie: session,
      'Content-Type': 'application/json',
      ...(stream ? { Accept: 'application/x-ndjson' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ?? null,
  });
}
beforeEach(async () => {
  store = createStore(':memory:', Date.now());
  const port = {
    available: true,
    call: async (operation: keyof typeof store.operations, ...args: never[]) =>
      (store.operations[operation] as (...values: never[]) => unknown)(...args),
  } as StorePort;
  const app = createApi(
    readConfig({ NODE_ENV: 'test', GEMINI_API_KEY: 'fixture', TAVILY_API_KEY: 'fixture' }),
    () => {},
    () => true,
    port,
  );
  finishApp(app, () => {});
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  origin = `http://127.0.0.1:${address.port}`;
  cookie = (await api('/session', {}, '')).headers.get('set-cookie')!.split(';')[0]!;
  conversation = (
    (await (await api('/conversations', { title: 'Streaming' })).json()) as { id: string }
  ).id;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  vi.unstubAllGlobals();
});
it('streams over HTTP before completion, then persists and replays an idempotent final answer', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const provider = vi.fn(async (_url: string, init: RequestInit) =>
    isRouter(init)
      ? routeResponse.clone()
      : new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              source = c;
              c.enqueue(event('Hello '));
            },
          }),
        ),
  );
  vi.stubGlobal('fetch', provider);
  const input = { requestId: randomUUID(), text: 'Hello', timezone: 'UTC' };
  const response = await api(`/conversations/${conversation}/messages`, input, cookie, true);
  const lines = readLines(response.body!);
  let first = '';
  while (!first.includes('delta')) first = (await lines.next()).value as string;
  expect(first).toContain('Hello ');
  const pending = (await (await api(`/conversations/${conversation}/messages`)).json()) as {
    items: unknown[];
  };
  expect(pending.items).toHaveLength(1);
  source.enqueue(event('world.', true));
  source.close();
  const rest = [];
  for await (const line of lines) rest.push(JSON.parse(line));
  expect(rest.at(-1)).toMatchObject({ type: 'done', state: 'completed' });
  const saved = (await (await api(`/conversations/${conversation}/messages`)).json()) as {
    items: Array<{ text: string }>;
  };
  expect(saved.items.map((x) => x.text)).toEqual(['Hello', 'Hello world.']);
  expect(await (await api(`/conversations/${conversation}/messages`, input)).json()).toMatchObject({
    state: 'completed',
  });
  expect(provider).toHaveBeenCalledTimes(1);
});
it('authorizes cancellation, aborts the provider, and retries without duplicating the question', async () => {
  let providerSignal!: AbortSignal;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      if (isRouter(init)) return routeResponse.clone();
      providerSignal = init.signal as AbortSignal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(event('Partial'));
            providerSignal.addEventListener('abort', () => c.error(new Error('cancelled')), {
              once: true,
            });
          },
        }),
      );
    }),
  );
  const response = await api(
    `/conversations/${conversation}/messages`,
    { requestId: randomUUID(), text: 'Please help', timezone: 'UTC' },
    cookie,
    true,
  );
  const lines = readLines(response.body!);
  while (!String((await lines.next()).value).includes('delta')) {
    /* wait for provider */
  }
  const turn = (await (await api(`/conversations/${conversation}/latest-turn`)).json()) as {
    id: string;
  };
  const foreign = (await api('/session', {}, '')).headers.get('set-cookie')!.split(';')[0]!;
  expect(
    (await api(`/conversations/${conversation}/turns/${turn.id}/cancel`, {}, foreign)).status,
  ).toBe(404);
  expect(providerSignal.aborted).toBe(false);
  expect((await api(`/conversations/${conversation}/turns/${turn.id}/cancel`, {})).ok).toBe(true);
  const events = [];
  for await (const line of lines) events.push(JSON.parse(line));
  expect(events.at(-1)).toMatchObject({ type: 'error', code: 'AGENT_CANCELLED' });
  expect(providerSignal.aborted).toBe(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) =>
      isRouter(init) ? routeResponse.clone() : new Response(event('Complete.', true)),
    ),
  );
  const retried = await api(
    `/conversations/${conversation}/turns/${turn.id}/retry`,
    { requestId: randomUUID() },
    cookie,
    true,
  );
  expect(await retried.text()).toContain('"state":"completed"');
  const saved = (await (await api(`/conversations/${conversation}/messages`)).json()) as {
    items: Array<{ text: string }>;
  };
  expect(saved.items.map((x) => x.text)).toEqual(['Please help', 'Complete.']);
});
it('cancels on client disconnect without storing partial output', async () => {
  let providerSignal!: AbortSignal;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      if (isRouter(init)) return routeResponse.clone();
      providerSignal = init.signal as AbortSignal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(event('Partial'));
            providerSignal.addEventListener('abort', () => c.error(new Error('disconnected')), {
              once: true,
            });
          },
        }),
      );
    }),
  );
  const controller = new AbortController();
  const response = await api(
    `/conversations/${conversation}/messages`,
    { requestId: randomUUID(), text: 'Hello', timezone: 'UTC' },
    cookie,
    true,
    controller.signal,
  );
  const lines = readLines(response.body!);
  while (!String((await lines.next()).value).includes('delta')) {
    /* wait */
  }
  controller.abort();
  await lines.return(undefined).catch(() => {});
  await vi.waitFor(() => expect(providerSignal.aborted).toBe(true));
  await vi.waitFor(async () =>
    expect(await (await api(`/conversations/${conversation}/latest-turn`)).json()).toMatchObject({
      state: 'cancelled',
    }),
  );
  const saved = (await (await api(`/conversations/${conversation}/messages`)).json()) as {
    items: unknown[];
  };
  expect(saved.items).toHaveLength(1);
});
