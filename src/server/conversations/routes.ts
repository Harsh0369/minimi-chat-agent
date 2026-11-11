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
export function persistenceRouter(store: StorePort, clock: () => number = Date.now) {
  const router = Router();
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
  router.post('/conversations/:id/turns/:turnId/cancel', async (req, res) => {
    empty.parse(req.body);
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
    await store.call('conversation', String(res.locals.ownerId), id.parse(req.params.id));
    throw new AppError(503, 'AGENT_NOT_READY', 'Chat is not available yet.');
  });
  router.delete('/history', async (req, res) => {
    await store.call('deleteHistory', String(res.locals.ownerId));
    res.status(204).end();
  });
  return router;
}
