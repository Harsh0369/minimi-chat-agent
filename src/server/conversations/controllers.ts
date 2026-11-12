import type { RequestHandler, Request, Response } from 'express';
import { z } from 'zod';
import type { StorePort } from '../storage/client.js';
import {
  createSessionService,
  readSessionCookie,
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
} from '../sessions/service.js';
import { publicError } from '../http/errors.js';
import { openStream } from '../http/stream.js';
import { createTurnService } from './turnService.js';
import type { Logger } from '../logger.js';
import { log } from '../logger.js';
import type { Config } from '../config.js';
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
export function createControllers(
  store: StorePort,
  clock: () => number = Date.now,
  config?: Config,
  logger: Logger = log,
) {
  const turns = createTurnService(store, clock, config);
  const sessions = createSessionService(store, clock);
  const establishSession: RequestHandler = async (req, res) => {
    empty.parse(req.body);
    const { session, token } = await sessions.establish(readSessionCookie(req.headers.cookie));
    if (token) res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_LIFETIME_MS });
    res.json({ expiresAt: session.expiresAt });
  };
  const getSession: RequestHandler = async (req, res) => {
    const session = await sessions.require(readSessionCookie(req.headers.cookie));
    res.json({ expiresAt: session.expiresAt });
  };
  const revokeSession: RequestHandler = async (req, res) => {
    await sessions.revoke(readSessionCookie(req.headers.cookie));
    res.clearCookie(SESSION_COOKIE, cookieOptions).status(204).end();
  };
  const requireSession: RequestHandler = async (req, res, next) => {
    const session = await sessions.require(readSessionCookie(req.headers.cookie));
    res.locals.ownerId = session.ownerId;
    next();
  };
  const createConversation: RequestHandler = async (req, res) => {
    const { title } = z
      .strictObject({ title: z.string().trim().min(1).max(200).default('New conversation') })
      .parse(req.body);
    res
      .status(201)
      .json(await store.call('createConversation', String(res.locals.ownerId), title, clock()));
  };
  const listConversations: RequestHandler = async (req, res) => {
    const { before, limit } = page.parse(req.query);
    res.json(await store.call('conversations', String(res.locals.ownerId), before, limit));
  };
  const getConversation: RequestHandler = async (req, res) => {
    res.json(await store.call('conversation', String(res.locals.ownerId), id.parse(req.params.id)));
  };
  const deleteConversation: RequestHandler = async (req, res) => {
    await store.call('deleteConversation', String(res.locals.ownerId), id.parse(req.params.id));
    res.status(204).end();
  };
  const listMessages: RequestHandler = async (req, res) => {
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
  };
  const searchMessages: RequestHandler = async (req, res) => {
    const query = z
      .strictObject({
        q: z.string().trim().min(2).max(100),
        conversationId: z.uuid().optional(),
      })
      .parse(req.query);
    res.json(
      await store.call(
        'searchMessages',
        String(res.locals.ownerId),
        query.q,
        query.conversationId ?? null,
      ),
    );
  };
  const getTurn: RequestHandler = async (req, res) => {
    res.json(
      await store.call(
        'turn',
        String(res.locals.ownerId),
        id.parse(req.params.id),
        id.parse(req.params.turnId),
      ),
    );
  };
  const latestTurn: RequestHandler = async (req, res) => {
    const turn = await store.call(
      'latestTurn',
      String(res.locals.ownerId),
      id.parse(req.params.id),
    );
    res.json(turn ?? null);
  };
  const turnSources: RequestHandler = async (req, res) => {
    res.json(
      await store.call(
        'turnSources',
        String(res.locals.ownerId),
        id.parse(req.params.id),
        id.parse(req.params.turnId),
      ),
    );
  };
  const cancelTurn: RequestHandler = async (req, res) => {
    empty.parse(req.body);
    await store.call(
      'turn',
      String(res.locals.ownerId),
      id.parse(req.params.id),
      id.parse(req.params.turnId),
    );
    turns.cancel(id.parse(req.params.turnId));
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
  };
  const submitMessage: RequestHandler = async (req, res) => {
    const ownerId = String(res.locals.ownerId),
      conversationId = id.parse(req.params.id);
    const input = submitMessageSchema.parse(req.body);
    const release = turns.reserve();
    try {
      const existing = await store.call('beginTurn', ownerId, conversationId, input, clock());
      if (existing.state !== 'pending' || turns.isActive(existing.id)) {
        res.json(existing);
        return;
      }
      await respond(req, res, ownerId, conversationId, existing, input);
    } finally {
      release();
    }
  };
  const editMessage: RequestHandler = async (req, res) => {
    const ownerId = String(res.locals.ownerId),
      conversationId = id.parse(req.params.id),
      messageId = id.parse(req.params.messageId);
    const input = submitMessageSchema.parse(req.body);
    const release = turns.reserve();
    try {
      const replacement = await store.call(
        'editMessage',
        ownerId,
        conversationId,
        messageId,
        input,
        clock(),
      );
      await respond(req, res, ownerId, conversationId, replacement, input);
    } finally {
      release();
    }
  };
  const retryTurn: RequestHandler = async (req, res) => {
    const ownerId = String(res.locals.ownerId),
      conversationId = id.parse(req.params.id),
      turnId = id.parse(req.params.turnId);
    const { requestId } = z.strictObject({ requestId: z.uuid() }).parse(req.body);
    const release = turns.reserve();
    try {
      const retry = await store.call(
        'retryTurn',
        ownerId,
        conversationId,
        turnId,
        requestId,
        clock(),
      );
      if (retry.state !== 'pending' || turns.isActive(retry.id)) {
        res.json(retry);
        return;
      }
      const message = await store.call('turnMessage', ownerId, conversationId, retry.id);
      await respond(req, res, ownerId, conversationId, retry, message);
    } finally {
      release();
    }
  };
  const deleteHistory: RequestHandler = async (req, res) => {
    await store.call('deleteHistory', String(res.locals.ownerId));
    res.status(204).end();
  };
  async function respond(
    req: Request,
    res: Response,
    owner: string,
    conversation: string,
    turn: Turn,
    input: { text: string; timezone: string },
  ) {
    if (!req.headers.accept?.includes('application/x-ndjson')) {
      res.json(await turns.execute(owner, conversation, turn, input));
      return;
    }
    const stream = openStream(res);
    try {
      const completed = await turns.execute(
        owner,
        conversation,
        turn,
        input,
        stream.emit,
        stream.signal,
      );
      await stream.emit({ type: 'done', turnId: completed.id, state: completed.state });
    } catch (cause) {
      const safe = publicError(cause);
      logger({
        event: 'request_error',
        requestId: String(res.locals.requestId),
        status: safe.status,
        code: safe.code,
      });
      if (!stream.signal.aborted)
        await stream
          .emit({ type: 'error', code: safe.code, message: safe.message })
          .catch(() => {});
    } finally {
      stream.close();
    }
  }
  return {
    establishSession,
    getSession,
    revokeSession,
    requireSession,
    createConversation,
    listConversations,
    getConversation,
    deleteConversation,
    listMessages,
    searchMessages,
    getTurn,
    latestTurn,
    turnSources,
    cancelTurn,
    submitMessage,
    editMessage,
    retryTurn,
    deleteHistory,
  };
}
