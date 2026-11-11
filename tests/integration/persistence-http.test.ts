import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi, finishApp } from '../../src/server/app.js';
import { openDatabase, type DatabaseClient } from '../../src/server/storage/client.js';
import { readConfig } from '../../src/server/config.js';
import type { LogEvent } from '../../src/server/logger.js';

let folder: string, db: DatabaseClient, server: Server, origin: string;
let logs: LogEvent[];
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'thread-api-'));
  db = await openDatabase(join(folder, 'test.sqlite'));
  logs = [];
  const logger = (event: LogEvent) => {
    logs.push(event);
  };
  const app = createApi(readConfig({ NODE_ENV: 'test' }), logger, () => true, db);
  finishApp(app, logger);
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  origin = 'http://127.0.0.1:' + address.port;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await db.close();
  await rm(folder, { recursive: true, force: true });
});
function api(path: string, method = 'GET', cookie = '', body?: unknown) {
  return fetch(origin + '/api' + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function session() {
  const response = await api('/session', 'POST', '', {});
  expect(response.status).toBe(200);
  const setCookie = response.headers.get('set-cookie')!;
  return { cookie: setCookie.split(';')[0]!, setCookie, response };
}
async function conversation(cookie: string, title = 'New question') {
  const response = await api('/conversations', 'POST', cookie, { title });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}
describe('session and conversation HTTP API', () => {
  it('issues a persistent HttpOnly session without leaking the credential or owner into JSON/logs', async () => {
    const { cookie, setCookie, response } = await session();
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Max-Age=2592000');
    expect(setCookie).not.toContain('Domain=');
    const data = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(['expiresAt']);
    expect(JSON.stringify(logs)).not.toContain(cookie.split('=')[1]);
    const resumed = await api('/session', 'POST', cookie, {});
    expect(resumed.headers.get('set-cookie')).toBeNull();
    expect(await resumed.json()).toEqual(data);
  });
  it('requires an issued session and rejects forged, duplicate or malformed cookies', async () => {
    expect((await api('/conversations')).status).toBe(401);
    for (const cookie of [
      'thread_session=broken',
      'thread_session=' + 'a'.repeat(43),
      'thread_session=' + 'a'.repeat(43) + '; thread_session=' + 'b'.repeat(43),
    ]) {
      const response = await api('/session', 'POST', cookie, {});
      expect(response.status).toBe(401);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    const { cookie } = await session();
    await api('/session', 'DELETE', cookie);
    expect((await api('/conversations', 'GET', cookie)).status).toBe(401);
  });
  it('isolates lists, messages, turns and deletion; hides foreign resource existence', async () => {
    const a = await session(),
      b = await session();
    const c = await conversation(a.cookie);
    expect(await (await api('/conversations', 'GET', b.cookie)).json()).toEqual({
      items: [],
      hasMore: false,
    });
    for (const path of [
      '/conversations/' + c.id,
      '/conversations/' + c.id + '/messages',
      '/conversations/' + c.id + '/turns/' + randomUUID(),
    ]) {
      expect((await api(path, 'GET', b.cookie)).status).toBe(404);
    }
    expect((await api('/conversations/' + c.id, 'DELETE', b.cookie)).status).toBe(404);
    expect((await api('/conversations/' + c.id, 'GET', a.cookie)).status).toBe(200);
  });
  it('rejects spoofed ownership, invalid identifiers, unbounded pages and foreign-origin mutations', async () => {
    const { cookie } = await session();
    expect(
      (await api('/conversations', 'POST', cookie, { title: 'x', ownerId: randomUUID() })).status,
    ).toBe(400);
    expect((await api('/conversations/not-an-id', 'GET', cookie)).status).toBe(400);
    expect((await api('/conversations?limit=100000', 'GET', cookie)).status).toBe(400);
    expect((await api('/conversations?before=-1', 'GET', cookie)).status).toBe(400);
    const response = await fetch(origin + '/api/conversations', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://elsewhere.example',
        'Content-Type': 'application/json',
      },
      body: '{"title":"forged"}',
    });
    expect(response.status).toBe(403);
    expect(
      ((await (await api('/conversations', 'GET', cookie)).json()) as { items: unknown[] }).items,
    ).toHaveLength(0);
  });
  it('refuses real chat admission until the agent module exists and never invents replies', async () => {
    const { cookie } = await session(),
      c = await conversation(cookie);
    const response = await api('/conversations/' + c.id + '/messages', 'POST', cookie, {
      requestId: randomUUID(),
      text: 'Hello',
      timezone: 'UTC',
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'PROVIDER_NOT_CONFIGURED' } });
    expect(await (await api('/conversations/' + c.id + '/messages', 'GET', cookie)).json()).toEqual(
      { items: [], hasMore: false },
    );
  });
  it('deletes only the current owner history and keeps the session valid', async () => {
    const a = await session(),
      b = await session();
    const c = await conversation(a.cookie),
      other = await conversation(b.cookie);
    expect((await api('/history', 'DELETE', a.cookie)).status).toBe(204);
    expect((await api('/conversations/' + c.id, 'GET', a.cookie)).status).toBe(404);
    expect((await api('/conversations/' + other.id, 'GET', b.cookie)).status).toBe(200);
    expect((await api('/session', 'GET', a.cookie)).status).toBe(200);
  });
  it('reports storage failure as unavailable and never exposes worker internals', async () => {
    const { cookie } = await session();
    await db.forceClose();
    const response = await api('/conversations', 'GET', cookie);
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('DATABASE_UNAVAILABLE');
    expect(body).not.toContain(folder);
    expect((await api('/health')).status).toBe(503);
  });
});
