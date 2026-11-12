import { Router } from 'express';
import type { StorePort } from '../storage/client.js';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { createControllers } from './controllers.js';
import { turnRateLimit } from '../http/rateLimit.js';

export function persistenceRouter(
  store: StorePort,
  clock: () => number = Date.now,
  config?: Config,
  logger?: Logger,
) {
  const router = Router();
  const handlers = createControllers(store, clock, config, logger);
  const limitTurns = turnRateLimit(clock);
  router.post('/session', handlers.establishSession);
  router.get('/session', handlers.getSession);
  router.delete('/session', handlers.revokeSession);
  router.use(['/conversations', '/history', '/search'], handlers.requireSession);
  router.get('/search', handlers.searchMessages);
  router.post('/conversations', handlers.createConversation);
  router.get('/conversations', handlers.listConversations);
  router.get('/conversations/:id', handlers.getConversation);
  router.delete('/conversations/:id', handlers.deleteConversation);
  router.get('/conversations/:id/messages', handlers.listMessages);
  router.get('/conversations/:id/turns/:turnId', handlers.getTurn);
  router.get('/conversations/:id/latest-turn', handlers.latestTurn);
  router.get('/conversations/:id/turns/:turnId/sources', handlers.turnSources);
  router.post('/conversations/:id/turns/:turnId/cancel', handlers.cancelTurn);
  router.post('/conversations/:id/messages', limitTurns, handlers.submitMessage);
  router.post('/conversations/:id/messages/:messageId/edit', limitTurns, handlers.editMessage);
  router.post('/conversations/:id/turns/:turnId/retry', limitTurns, handlers.retryTurn);
  router.delete('/history', handlers.deleteHistory);
  return router;
}
