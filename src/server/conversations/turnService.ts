import type { StorePort } from '../storage/client.js';
import { missingProviderSettings, type Config } from '../config.js';
import type { Turn } from '../storage/store.js';
import type { EmitEvent } from '../../shared/stream.js';
import { AppError } from '../http/errors.js';
import { answer } from '../agent/service.js';
import { indexPendingMemory } from '../agent/semantic.js';
import { log } from '../logger.js';

export function createTurnService(store: StorePort, clock: () => number, config?: Config) {
  const active = new Map<string, AbortController>();
  const indexing = new Set<string>();
  let admitted = 0;
  function reserve() {
    requireProviders();
    if (admitted >= (config?.modelProvider === 'groq' ? 1 : 3))
      throw new AppError(429, 'AGENT_BUSY', 'Answers are already in progress. Retry shortly.');
    admitted++;
    return () => {
      admitted--;
    };
  }
  async function execute(
    ownerId: string,
    conversationId: string,
    turn: Turn,
    input: { text: string; timezone: string },
    emit?: EmitEvent,
    disconnected?: AbortSignal,
  ) {
    requireProviders();
    const controller = new AbortController();
    active.set(turn.id, controller);
    const deadline = AbortSignal.timeout(45_000);
    const signal = AbortSignal.any([
      controller.signal,
      deadline,
      ...(disconnected ? [disconnected] : []),
    ]);
    try {
      await store.call('startTurn', ownerId, conversationId, turn.id, clock());
      const result = await answer(
        config!,
        store,
        ownerId,
        conversationId,
        input.text,
        turn.userMessageId,
        input.timezone,
        clock(),
        signal,
        emit,
      );
      signal.throwIfAborted();
      const completed = await store.call(
        'completeTurn',
        ownerId,
        conversationId,
        turn.id,
        result.text,
        clock(),
        result.citations,
      );
      const embeddingModel = config?.embeddingModel;
      const embeddingKey = config?.geminiApiKey;
      if (embeddingModel && embeddingKey && !indexing.has(ownerId)) {
        indexing.add(ownerId);
        void indexPendingMemory(
          embeddingKey,
          embeddingModel,
          store,
          ownerId,
          AbortSignal.timeout(8_000),
        )
          .catch(() => {})
          .finally(() => indexing.delete(ownerId));
      }
      return completed;
    } catch (error) {
      if (process.env.PERF_LOG === '1') {
        const rawStatus =
          typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
        const rawCode = error instanceof Error ? error.message : '';
        log({
          event: 'agent_failure_debug',
          code: /^[A-Z][A-Z0-9_]{2,50}$/.test(rawCode) ? rawCode : 'UPSTREAM_OR_UNKNOWN',
          status: typeof rawStatus === 'number' ? rawStatus : null,
        });
      }
      try {
        await store.call(
          'stopTurn',
          ownerId,
          conversationId,
          turn.id,
          signal.aborted && !deadline.aborted ? 'cancelled' : 'failed',
          clock(),
        );
      } catch {
        /* Already cancelled. */
      }
      const rateLimited =
        typeof error === 'object' && error !== null && 'status' in error && error.status === 429;
      throw new AppError(
        deadline.aborted ? 504 : signal.aborted ? 409 : rateLimited ? 429 : 502,
        deadline.aborted
          ? 'AGENT_TIMEOUT'
          : signal.aborted
            ? 'AGENT_CANCELLED'
            : rateLimited
              ? 'MODEL_RATE_LIMITED'
              : 'AGENT_FAILED',
        rateLimited
          ? 'The model provider is rate limited. Retry shortly.'
          : 'The answer could not be completed. You can retry.',
      );
    } finally {
      active.delete(turn.id);
    }
  }
  function requireProviders() {
    const missing = config ? missingProviderSettings(config) : ['MODEL_PROVIDER'];
    if (missing.length)
      throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', `Set ${missing.join(', ')} in .env.`);
  }
  return {
    reserve,
    execute,
    isActive: (id: string) => active.has(id),
    cancel: (id: string) => active.get(id)?.abort(),
  };
}
