import { expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { turnRateLimit } from '../../src/server/http/rateLimit.js';
it('rejects the seventh turn, provides retry time, and resets after a minute', () => {
  let now = 1000;
  const limiter = turnRateLimit(() => now),
    next = vi.fn(),
    setHeader = vi.fn();
  for (let i = 0; i < 7; i++) limiter({} as Request, { setHeader } as unknown as Response, next);
  expect(next.mock.calls[6]?.[0]).toMatchObject({ code: 'TURN_RATE_LIMIT' });
  expect(setHeader).toHaveBeenCalledWith('Retry-After', 60);
  now += 60000;
  limiter({} as Request, { setHeader } as unknown as Response, next);
  expect(next.mock.calls[7]).toEqual([]);
});
