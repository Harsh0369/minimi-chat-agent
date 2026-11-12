import type { StorePort } from '../storage/client.js';
import type { Config } from '../config.js';
import type { Turn } from '../storage/store.js';
import type { EmitEvent } from '../../shared/stream.js';
import { AppError } from '../http/errors.js';
import { answer } from '../agent/service.js';

export function createTurnService(store: StorePort, clock: () => number, config?: Config) {
  const active = new Map<string, AbortController>();
  let admitted = 0;
  function reserve() {
    requireProviders();
    if (admitted >= 3)
      throw new AppError(
        429,
        'AGENT_BUSY',
        'Three answers are already in progress. Retry shortly.',
      );
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
    if (!config?.geminiApiKey || !config.tavilyApiKey)
      throw new AppError(
        503,
        'PROVIDER_NOT_CONFIGURED',
        'Set GEMINI_API_KEY and TAVILY_API_KEY in .env.',
      );
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
        config,
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
      const sources = result.citations.length
        ? '\n\nSources:\n' +
          result.citations.map((item) => `[${item.id}] ${item.title} — ${item.url}`).join('\n')
        : '';
      return await store.call(
        'completeTurn',
        ownerId,
        conversationId,
        turn.id,
        result.text + sources,
        clock(),
        result.citations,
      );
    } catch {
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
      throw new AppError(
        deadline.aborted ? 504 : signal.aborted ? 409 : 502,
        deadline.aborted ? 'AGENT_TIMEOUT' : signal.aborted ? 'AGENT_CANCELLED' : 'AGENT_FAILED',
        'The answer could not be completed. You can retry.',
      );
    } finally {
      active.delete(turn.id);
    }
  }
  function requireProviders() {
    if (!config?.geminiApiKey || !config.tavilyApiKey)
      throw new AppError(
        503,
        'PROVIDER_NOT_CONFIGURED',
        'Set GEMINI_API_KEY and TAVILY_API_KEY in .env.',
      );
  }
  return {
    reserve,
    execute,
    isActive: (id: string) => active.has(id),
    cancel: (id: string) => active.get(id)?.abort(),
  };
}
