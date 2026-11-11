import type { RequestHandler } from 'express';
import { AppError } from './errors.js';

export function turnRateLimit(now = Date.now): RequestHandler {
  // Local-process budget survives cookie resets, and bounds provider spending over time.
  let start = now(),
    count = 0;
  return (_req, res, next) => {
    if (now() - start >= 60000) {
      start = now();
      count = 0;
    }
    if (++count > 6) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((60000 - now() + start) / 1000)));
      next(
        new AppError(
          429,
          'TURN_RATE_LIMIT',
          'Too many questions in one minute. Please wait before trying again.',
        ),
      );
      return;
    }
    next();
  };
}
