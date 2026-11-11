import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Express } from 'express';
import type { Config } from './config.js';
import { missingProviderSettings } from './config.js';
import type { Logger } from './logger.js';
import { log } from './logger.js';
import { attachNonce, localBoundary, securityHeaders } from './http/security.js';
import { AppError, errorHandler, notFound } from './http/errors.js';
import { serviceStatusSchema } from '../shared/contracts.js';

export function createApi(config: Config, logger: Logger = log): Express {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.once('finish', () =>
      logger({
        event: 'request_complete',
        requestId,
        method: req.method,
        status: res.statusCode,
        elapsedMs: Math.round(performance.now() - started),
      }),
    );
    next();
  });
  app.use(attachNonce, securityHeaders(config), localBoundary(config));
  app.use('/api', (req, _res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send application/json.'));
      return;
    }
    next();
  });
  app.use('/api', express.json({ limit: 96 * 1024, strict: true, inflate: false }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/status', (_req, res) => {
    const missing = missingProviderSettings(config);
    res.json(
      serviceStatusSchema.parse({
        stage: 'foundation',
        capabilities: { chat: false, memory: false, webSearch: false },
        configuration: { providersConfigured: missing.length === 0, missing },
      }),
    );
  });
  return app;
}

// Attach after feature routers and frontend middleware, so API misses never become HTML.
export function finishApp(app: Express, logger: Logger = log): void {
  app.use(notFound);
  app.use(errorHandler(logger));
}
