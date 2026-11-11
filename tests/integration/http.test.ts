import { createServer, request, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi, finishApp } from '../../src/server/app.js';
import { readConfig } from '../../src/server/config.js';
import {
  apiErrorSchema,
  serviceStatusSchema,
  submitMessageSchema,
} from '../../src/shared/contracts.js';
import type { LogEvent } from '../../src/server/logger.js';

let server: Server;
let origin: string;
const logs: LogEvent[] = [];
const privateFixture = 'synthetic-provider-key-do-not-disclose';
beforeAll(async () => {
  const logger = (event: LogEvent) => {
    logs.push(event);
  };
  const app = createApi(
    readConfig({
      NODE_ENV: 'test',
      OPENAI_API_KEY: privateFixture,
      TAVILY_API_KEY: privateFixture,
      CHAT_MODEL: 'fixture-model',
    }),
    logger,
  );
  // Test-only routes exercise the production middleware; they are not app endpoints.
  app.post('/api/test/input', (req, res) => res.json(submitMessageSchema.parse(req.body)));
  app.get('/api/test/fail', async () => {
    throw new Error(privateFixture);
  });
  finishApp(app, logger);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function post(body: string, headers: Record<string, string> = {}) {
  return fetch(`${origin}/api/test/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body,
  });
}

describe('local HTTP boundary', () => {
  it('returns real health and explicitly incomplete capabilities without exposing secrets', async () => {
    const health = await fetch(`${origin}/api/health`);
    expect(await health.json()).toEqual({ status: 'ok' });
    const response = await fetch(`${origin}/api/status`);
    const raw = await response.text();
    expect(raw).not.toContain(privateFixture);
    const status = serviceStatusSchema.parse(JSON.parse(raw));
    expect(status.configuration).toEqual({ providersConfigured: true, missing: [] });
    expect(status.capabilities).toEqual({ chat: false, memory: false, webSearch: false });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('handles rejected async routes without leaking the error into responses or logs', async () => {
    const response = await fetch(`${origin}/api/test/fail?secret=${privateFixture}`, {
      headers: { Authorization: `Bearer ${privateFixture}`, 'X-Request-Id': privateFixture },
    });
    expect(response.status).toBe(500);
    const error = apiErrorSchema.parse(await response.json());
    expect(error.error.code).toBe('INTERNAL_ERROR');
    expect(response.headers.get('x-request-id')).toBe(error.error.requestId);
    expect(JSON.stringify(error)).not.toContain(privateFixture);
    expect(JSON.stringify(logs)).not.toContain(privateFixture);
  });

  it('rejects DNS-rebinding hosts even if a forwarded header pretends to be local', async () => {
    // Node fetch replaces Host. A raw HTTP request is required to test this boundary.
    const response = await new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        const req = request(
          `${origin}/api/health`,
          {
            headers: { Host: 'attacker.example', 'X-Forwarded-Host': new URL(origin).host },
          },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              body += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, body }));
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.end();
      },
    );
    expect(response.status).toBe(403);
    expect(apiErrorSchema.parse(JSON.parse(response.body)).error.code).toBe('INVALID_HOST');
  });

  it.each(['https://attacker.example', 'null', 'http://127.0.0.1:1'])(
    'rejects foreign Origin %s',
    async (Origin) => {
      const response = await post('{}', { Origin });
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    },
  );

  it('requires same-origin intent on mutation requests', async () => {
    const response = await fetch(`${origin}/api/test/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
  });

  it('rejects cross-site fetch metadata even on reads', async () => {
    const response = await fetch(`${origin}/api/status`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(response.status).toBe(403);
  });

  it('rejects malformed, oversized, and compressed JSON with stable error codes', async () => {
    for (const [body, headers, status, code] of [
      ['{"broken":', {}, 400, 'INVALID_JSON'],
      [JSON.stringify({ text: 'x'.repeat(100_000) }), {}, 413, 'BODY_TOO_LARGE'],
      ['{}', { 'Content-Encoding': 'gzip' }, 415, 'UNSUPPORTED_ENCODING'],
      ['{}', { 'Content-Type': 'text/plain' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ] as const) {
      const response = await post(body, headers);
      expect(response.status).toBe(status);
      expect(apiErrorSchema.parse(await response.json()).error.code).toBe(code);
    }
  });

  it('validates the input boundary and preserves accepted text', async () => {
    const valid = { requestId: randomUUID(), text: '  original text  ', timezone: 'Asia/Kolkata' };
    const response = await post(JSON.stringify(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(valid);
    expect((await post(JSON.stringify({ ...valid, text: '  ' }))).status).toBe(400);
  });

  it('returns JSON for unknown API routes rather than an HTML app shell', async () => {
    const response = await fetch(`${origin}/api/does-not-exist`);
    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('sets restrictive headers and independent nonces without upgrading local HTTP', async () => {
    const first = await fetch(`${origin}/api/health`);
    const second = await fetch(`${origin}/api/health`);
    const policy = first.headers.get('content-security-policy');
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toEqual(second.headers.get('content-security-policy'));
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');
    expect(first.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(first.headers.get('strict-transport-security')).toBeNull();
    expect(first.headers.get('x-powered-by')).toBeNull();
  });
});
