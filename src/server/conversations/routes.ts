import { Router } from 'express';
import { z } from 'zod';
import type { StorePort } from '../storage/client.js';
import {
  createSessionService,
  readSessionCookie,
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
} from '../sessions/service.js';
import { AppError } from '../http/errors.js';
import type { Config } from '../config.js';
import { answer } from '../agent/service.js';
import { submitMessageSchema } from '../../shared/contracts.js';
import type { Turn } from '../storage/store.js';

const empty = z.strictObject({});
const id = z.uuid();
const page = z.strictObject({
  before: z.coerce
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(Number.MAX_SAFE_INTEGER),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const messagePage = z.strictObject({
  after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, path: '/', secure: false };
// HTTP is intentionally loopback-only. Public HTTPS/account login is a separate deployment mode.
export function persistenceRouter(
  store: StorePort,
  clock: () => number = Date.now,
  config?: Config,
) {
  const router = Router();
  const active = new Map<string, AbortController>();
  let admitted = 0;
  function reserve() {
    if (admitted >= 3)
      throw new AppError(
        429,
        'AGENT_BUSY',
        'Three answers are already in progress. Retry shortly.',
      );
    admitted++;
  }
  async function execute(
    ownerId: string,
    conversationId: string,
    turn: Turn,
    input: { text: string; timezone: string },
  ) {
    if (!config?.geminiApiKey || !config.tavilyApiKey)
      throw new AppError(
        503,
        'PROVIDER_NOT_CONFIGURED',
        'Set GEMINI_API_KEY and TAVILY_API_KEY in .env.',
      );
    const controller = new AbortController();
    active.set(turn.id, controller);
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      await store.call('startTurn', ownerId, conversationId, turn.id, clock());
      const result = await answer(
        config,
        store,
        ownerId,
        conversationId,
        input.text,
        turn.userMessageId,
        input.timezone,
        clock(),
        controller.signal,
      );
      const sources = result.citations.length
        ? '\n\nSources:\n' +
          result.citations.map((item) => `[${item.id}] ${item.title} — ${item.url}`).join('\n')
        : '';
      return await store.call(
        'completeTurn',
        ownerId,
        conversationId,
        turn.id,
        result.text + sources,
        clock(),
        result.citations,
      );
    } catch {
      try {
        await store.call(
          'stopTurn',
          ownerId,
          conversationId,
          turn.id,
          controller.signal.aborted ? 'cancelled' : 'failed',
          clock(),
        );
      } catch {
        /* Already cancelled. */
      }
      throw new AppError(
        controller.signal.aborted ? 504 : 502,
        controller.signal.aborted ? 'AGENT_TIMEOUT' : 'AGENT_FAILED',
        'The answer could not be completed. You can retry.',
      );
    } finally {
      clearTimeout(timeout);
      active.delete(turn.id);
    }
  }
  const sessions = createSessionService(store, clock);
  router.post('/session', async (req, res) => {
    empty.parse(req.body);
    const { session, token } = await sessions.establish(readSessionCookie(req.headers.cookie));
    if (token) res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_LIFETIME_MS });
    res.json({ expiresAt: session.expiresAt });
  });
  router.get('/session', async (req, res) => {
    const session = await sessions.require(readSessionCookie(req.headers.cookie));
    res.json({ expiresAt: session.expiresAt });
  });
  router.delete('/session', async (req, res) => {
    await sessions.revoke(readSessionCookie(req.headers.cookie));
    res.clearCookie(SESSION_COOKIE, cookieOptions).status(204).end();
  });
  router.use(['/conversations', '/history'], async (req, res, next) => {
    const session = await sessions.require(readSessionCookie(req.headers.cookie));
    res.locals.ownerId = session.ownerId;
    next();
  });
  router.post('/conversations', async (req, res) => {
    const { title } = z
      .strictObject({ title: z.string().trim().min(1).max(200).default('New conversation') })
      .parse(req.body);
    res
      .status(201)
      .json(await store.call('createConversation', String(res.locals.ownerId), title, clock()));
  });
  router.get('/conversations', async (req, res) => {
    const { before, limit } = page.parse(req.query);
    res.json(await store.call('conversations', String(res.locals.ownerId), before, limit));
  });
  router.get('/conversations/:id', async (req, res) => {
    res.json(await store.call('conversation', String(res.locals.ownerId), id.parse(req.params.id)));
  });
  router.delete('/conversations/:id', async (req, res) => {
    await store.call('deleteConversation', String(res.locals.ownerId), id.parse(req.params.id));
    res.status(204).end();
  });
  router.get('/conversations/:id/messages', async (req, res) => {
    const { after, limit } = messagePage.parse(req.query);
    res.json(
      await store.call(
        'messages',
        String(res.locals.ownerId),
        id.parse(req.params.id),
        after,
        limit,
      ),
    );
  });
  router.get('/conversations/:id/turns/:turnId', async (req, res) => {
    res.json(
      await store.call(
        'turn',
        String(res.locals.ownerId),
        id.parse(req.params.id),
        id.parse(req.params.turnId),
      ),
    );
  });
  router.get('/conversations/:id/latest-turn', async (req, res) => {
    const turn = await store.call(
      'latestTurn',
      String(res.locals.ownerId),
      id.parse(req.params.id),
    );
    res.json(turn ?? null);
  });
  router.get('/conversations/:id/turns/:turnId/sources', async (req, res) => {
    res.json(
      await store.call(
        'turnSources',
        String(res.locals.ownerId),
        id.parse(req.params.id),
        id.parse(req.params.turnId),
      ),
    );
  });
  router.post('/conversations/:id/turns/:turnId/cancel', async (req, res) => {
    empty.parse(req.body);
    active.get(id.parse(req.params.turnId))?.abort();
    res.json(
      await store.call(
        'stopTurn',
        String(res.locals.ownerId),
        id.parse(req.params.id),
        id.parse(req.params.turnId),
        'cancelled',
        clock(),
      ),
    );
  });
  router.post('/conversations/:id/messages', async (req, res) => {
    const ownerId = String(res.locals.ownerId),
      conversationId = id.parse(req.params.id);
    if (!config?.geminiApiKey || !config.tavilyApiKey)
      throw new AppError(
        503,
        'PROVIDER_NOT_CONFIGURED',
        'Set GEMINI_API_KEY and TAVILY_API_KEY in .env.',
      );
    const input = submitMessageSchema.parse(req.body);
    reserve();
    try {
      const existing = await store.call('beginTurn', ownerId, conversationId, input, clock());
      if (existing.state !== 'pending' || active.has(existing.id)) {
        res.json(existing);
        return;
      }
      res.json(await execute(ownerId, conversationId, existing, input));
    } finally {
      admitted--;
    }
  });
  router.post('/conversations/:id/turns/:turnId/retry', async (req, res) => {
    if (!config?.geminiApiKey || !config.tavilyApiKey)
      throw new AppError(
        503,
        'PROVIDER_NOT_CONFIGURED',
        'Set GEMINI_API_KEY and TAVILY_API_KEY in .env.',
      );
    const ownerId = String(res.locals.ownerId),
      conversationId = id.parse(req.params.id),
      turnId = id.parse(req.params.turnId);
    const { requestId } = z.strictObject({ requestId: z.uuid() }).parse(req.body);
    reserve();
    try {
      const retry = await store.call(
        'retryTurn',
        ownerId,
        conversationId,
        turnId,
        requestId,
        clock(),
      );
      if (retry.state !== 'pending' || active.has(retry.id)) {
        res.json(retry);
        return;
      }
      const message = await store.call('turnMessage', ownerId, conversationId, retry.id);
      res.json(await execute(ownerId, conversationId, retry, message));
    } finally {
      admitted--;
    }
  });
  router.delete('/history', async (req, res) => {
    await store.call('deleteHistory', String(res.locals.ownerId));
    res.status(204).end();
  });
  return router;
}
