import { randomBytes } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import helmet from 'helmet';
import type { Config } from '../config.js';
import { AppError } from './errors.js';

export function localBoundary(config: Config): RequestHandler {
  return (req, _res, next) => {
    const port = req.socket.localPort;
    const host = config.host === '::1' ? '[::1]' : config.host;
    const authorities = new Set([`${host}:${port}`, `localhost:${port}`]);
    if (port === 80) {
      authorities.add(host);
      authorities.add('localhost');
    }
    const authority = req.headers.host?.toLowerCase();
    if (!authority || !authorities.has(authority)) {
      next(new AppError(403, 'INVALID_HOST', 'Use the local application address.'));
      return;
    }
    const origin = req.headers.origin;
    // All cross-origin requests are rejected; mutations additionally require an Origin.
    // Session ownership will be implemented in M2; this boundary is not authentication.
    if (
      (origin !== undefined && origin !== `http://${authority}`) ||
      (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin === undefined)
    ) {
      next(new AppError(403, 'INVALID_ORIGIN', 'Use the application in the same browser origin.'));
      return;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      next(new AppError(403, 'CROSS_SITE_REQUEST', 'Cross-site requests are not allowed.'));
      return;
    }
    next();
  };
}

export const attachNonce: RequestHandler = (_req, res, next) => {
  res.locals.cspNonce = randomBytes(18).toString('base64');
  next();
};

export function securityHeaders(config: Config): RequestHandler {
  return helmet({
    strictTransportSecurity: false, // Loopback HTTP; do not pin localhost to HTTPS.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'", (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`],
        styleSrc: ["'self'", (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`],
        connectSrc:
          config.mode === 'development'
            ? ["'self'", `ws://127.0.0.1:${config.port}`, `ws://localhost:${config.port}`]
            : ["'self'"],
        workerSrc: config.mode === 'development' ? ["'self'", 'blob:'] : ["'self'"],
        imgSrc: ["'self'"],
        fontSrc: ["'self'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  });
}
