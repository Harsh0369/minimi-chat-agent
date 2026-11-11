import { createHash, randomBytes } from 'node:crypto';
import type { StorePort } from '../storage/client.js';
import { AppError } from '../http/errors.js';

export const SESSION_COOKIE = 'thread_session';
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export function readSessionCookie(header: string | undefined): string | undefined {
  const matches = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(SESSION_COOKIE + '='));
  if (!matches.length) return undefined;
  const token = matches[0]!.slice(SESSION_COOKIE.length + 1);
  if (matches.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AppError(401, 'SESSION_REQUIRED', 'Reopen your workspace to continue.');
  return token;
}
export function createSessionService(store: StorePort, clock: () => number = Date.now) {
  return {
    async establish(token?: string) {
      const now = clock();
      if (token)
        return { session: await store.call('session', digest(token), now), token: undefined };
      const issued = randomBytes(32).toString('base64url');
      const session = await store.call(
        'createSession',
        digest(issued),
        now,
        now + SESSION_LIFETIME_MS,
      );
      return { session, token: issued };
    },
    async require(token?: string) {
      if (!token) throw new AppError(401, 'SESSION_REQUIRED', 'Reopen your workspace to continue.');
      return store.call('session', digest(token), clock());
    },
    async revoke(token?: string) {
      if (token) await store.call('revokeSession', digest(token));
    },
  };
}
