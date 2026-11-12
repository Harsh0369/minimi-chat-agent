import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import type { StorePort } from '../../src/server/storage/client.js';

let modelCalls = 0;
vi.mock('@langchain/groq', () => ({
  ChatGroq: class {
    bindTools() {
      return this;
    }
    async invoke(messages: Array<{ content?: unknown; tool_call_id?: string }>) {
      const system = String(messages[0]?.content ?? '');
      if (system.includes('Choose the context'))
        return new AIMessage(
          JSON.stringify({ scope: 'THREAD', needsClock: false, clockZones: [] }),
        );
      if (system.includes('You are an evidence auditor'))
        return new AIMessage(JSON.stringify({ answer: 'Acme lists its price [S1].' }));
      modelCalls++;
      if (!messages.some((message) => message.tool_call_id))
        return new AIMessage({
          content: '',
          tool_calls: [
            { id: 'call-1', name: 'web_search', args: { query: 'Acme official pricing' } },
          ],
        });
      return new AIMessage('Acme lists its price [S1].');
    }
  },
}));

import { readConfig } from '../../src/server/config.js';
import { answer } from '../../src/server/agent/service.js';
import { createStore } from '../../src/server/storage/store.js';

afterEach(() => vi.unstubAllGlobals());

it('answers through Groq with the same Tavily evidence and citation boundary', async () => {
  modelCalls = 0;
  const now = Date.UTC(2026, 10, 12, 12);
  const store = createStore(':memory:', now);
  const port = {
    available: true,
    call: async (operation: keyof typeof store.operations, ...args: never[]) => {
      const fn = store.operations[operation] as (...values: never[]) => unknown;
      return fn(...args);
    },
  } as StorePort;
  const owner = store.operations.createSession('groq-owner', now, now + 10000).ownerId;
  const conversation = store.operations.createConversation(owner, 'New conversation', now);
  const turn = store.operations.beginTurn(
    owner,
    conversation.id,
    { requestId: randomUUID(), text: 'What is Acme pricing?', timezone: 'UTC' },
    now,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(url).toBe('https://api.tavily.com/search');
      return Response.json({
        results: [
          {
            title: 'Acme pricing',
            url: 'https://example.com/pricing',
            content: 'Current official price',
          },
        ],
      });
    }),
  );
  try {
    const result = await answer(
      readConfig({ MODEL_PROVIDER: 'groq', GROQ_API_KEY: 'fixture', TAVILY_API_KEY: 'fixture' }),
      port,
      owner,
      conversation.id,
      'What is Acme pricing?',
      turn.userMessageId,
      'UTC',
      now,
      new AbortController().signal,
    );
    expect(modelCalls).toBe(2);
    expect(result.text).toContain('[S1]');
    expect(result.citations).toMatchObject([{ url: 'https://example.com/pricing' }]);
  } finally {
    store.close();
  }
});
