import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { Logger } from '../logger.js';
import { StoreError } from '../storage/errors.js';

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

export function sendAppError(res: Response, logger: Logger, error: AppError): void {
  const requestId = String(res.locals.requestId);
  logger({ event: 'request_error', requestId, status: error.status, code: error.code });
  res.status(error.status).json({ error: { code: error.code, message: error.message, requestId } });
}

export function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof StoreError) {
    const mapped: Record<string, [number, string]> = {
      SESSION_REQUIRED: [401, 'Reopen your workspace to continue.'],
      NOT_FOUND: [404, 'This conversation or turn does not exist.'],
      INVALID_INPUT: [400, 'Check the request fields.'],
      IDEMPOTENCY_CONFLICT: [409, 'This request ID has already been used for different content.'],
      CONVERSATION_BUSY: [409, 'A response is already in progress.'],
      INVALID_TURN_STATE: [409, 'This turn cannot be changed in its current state.'],
      DATABASE_BUSY: [503, 'Your workspace is busy. Try again shortly.'],
      DATABASE_UNAVAILABLE: [503, 'Your workspace is unavailable. Restart the application.'],
    };
    const entry = mapped[error.code];
    return entry
      ? new AppError(entry[0], error.code, entry[1])
      : new AppError(500, 'DATABASE_ERROR', 'The operation could not be completed.');
  }
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
    sendAppError(res, logger, safe);
  };
}
