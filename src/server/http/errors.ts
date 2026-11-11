import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import type { Logger } from '../logger.js';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'This endpoint does not exist.'));
};

function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError)
    return new AppError(400, 'INVALID_INPUT', 'Check the request fields.');
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404) {
    return new AppError(404, 'NOT_FOUND', 'This resource does not exist.');
  }
  const type =
    typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
  if (type === 'entity.too.large')
    return new AppError(413, 'BODY_TOO_LARGE', 'The request is too large.');
  if (type === 'entity.parse.failed')
    return new AppError(400, 'INVALID_JSON', 'Send a valid JSON object.');
  if (type === 'encoding.unsupported' || type === 'charset.unsupported') {
    return new AppError(415, 'UNSUPPORTED_ENCODING', 'Send uncompressed UTF-8 JSON.');
  }
  if (type === 'request.aborted' || type === 'request.size.invalid') {
    return new AppError(400, 'INCOMPLETE_REQUEST', 'The request body was incomplete.');
  }
  return new AppError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const safe = publicError(error);
    const requestId = String(res.locals.requestId);
    logger({ event: 'request_error', requestId, status: safe.status, code: safe.code });
    res.status(safe.status).json({ error: { code: safe.code, message: safe.message, requestId } });
  };
}
