import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi, finishApp } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import { openDatabase } from '../../src/server/storage/client.js';

afterEach(() => vi.unstubAllGlobals());
describe('live HTTP turn with mocked providers', () => {
  it('persists a cited answer and source snapshot through the real API', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'agent-http-'));
    const db = await openDatabase(join(folder, 'test.sqlite'));
    const logger = () => {};
    const app = createApi(
      readConfig({ NODE_ENV: 'test', GEMINI_API_KEY: 'fixture', TAVILY_API_KEY: 'fixture' }),
      logger,
      () => true,
      db,
    );
    finishApp(app, logger);
    const server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const origin = `http://127.0.0.1:${address.port}`;
    const realFetch = globalThis.fetch;
    let modelCalls = 0;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(origin)) return realFetch(input, init);
      if (url.includes('generativelanguage')) {
        modelCalls++;
        return Response.json({
          candidates: [
            {
              content: {
                parts:
                  modelCalls === 1
                    ? [
                        {
                          functionCall: {
                            name: 'web_search',
                            args: { query: 'Acme official pricing' },
                          },
                        },
                      ]
                    : [{ text: 'Acme publishes its price [S1].' }],
              },
            },
          ],
        });
      }
      if (url === 'https://api.tavily.com/search')
        return Response.json({
          results: [
            {
              title: 'Acme pricing',
              url: 'https://example.com/pricing',
              content: 'A listed price',
              published_date: null,
            },
          ],
        });
      throw new Error('Unexpected external request');
    });
    const api = (path: string, method = 'GET', cookie = '', body?: unknown) =>
      fetch(`${origin}/api${path}`, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    try {
      const session = await api('/session', 'POST', '', {});
      expect(session.status).toBe(200);
      const cookie = session.headers.get('set-cookie')!.split(';')[0]!;
      const created = await api('/conversations', 'POST', cookie, { title: 'New conversation' });
      expect(created.status).toBe(201);
      const conversation = (await created.json()) as { id: string };
      const response = await api(`/conversations/${conversation.id}/messages`, 'POST', cookie, {
        requestId: randomUUID(),
        text: 'What is Acme pricing today?',
        timezone: 'UTC',
      });
      expect(response.status).toBe(200);
      const turn = (await response.json()) as { id: string; state: string };
      expect(turn.state).toBe('completed');
      const messages = (await (
        await api(`/conversations/${conversation.id}/messages`, 'GET', cookie)
      ).json()) as { items: Array<{ text: string }> };
      expect(messages.items).toHaveLength(2);
      expect(messages.items[1]?.text).toContain('https://example.com/pricing');
      const sources = (await (
        await api(`/conversations/${conversation.id}/turns/${turn.id}/sources`, 'GET', cookie)
      ).json()) as Array<{ url: string; excerpt: string }>;
      expect(sources).toMatchObject([
        { url: 'https://example.com/pricing', excerpt: 'A listed price' },
      ]);
      expect(modelCalls).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
