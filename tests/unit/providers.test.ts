import { describe, expect, it, vi } from 'vitest';
import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { readConfig } from '../../src/server/config.js';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ model: string; messages: unknown[]; tools: boolean }>,
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    constructor(readonly settings: { model: string }) {}
    bindTools() {
      return this;
    }
    async invoke(messages: unknown[]) {
      state.calls.push({ model: this.settings.model, messages, tools: true });
      return new AIMessage({
        content: 'Done.',
        tool_calls: [],
      });
    }
    async stream(messages: unknown[]) {
      state.calls.push({ model: this.settings.model, messages, tools: true });
      return (async function* () {
        yield new AIMessageChunk({ content: 'Hel' });
        yield new AIMessageChunk({ content: 'lo' });
      })();
    }
  },
}));
vi.mock('@langchain/groq', () => ({
  ChatGroq: class {
    constructor(readonly settings: { model: string }) {}
    bindTools() {
      return this;
    }
    async invoke(messages: unknown[]) {
      state.calls.push({ model: this.settings.model, messages, tools: true });
      return new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'web_search', args: { query: 'official pricing' } }],
      });
    }
    async stream(messages: unknown[]) {
      state.calls.push({ model: this.settings.model, messages, tools: true });
      return (async function* () {
        yield new AIMessageChunk({
          content: '',
          tool_call_chunks: [
            { id: 'call-1', name: 'web_search', args: '{"query":"official', index: 0 },
          ],
        });
        yield new AIMessageChunk({
          content: '',
          tool_call_chunks: [{ args: ' pricing"}', index: 0 }],
        });
      })();
    }
  },
}));

import { createGenerate } from '../../src/server/agent/providers.js';

describe('model provider boundary', () => {
  it('passes one Groq tool call and its result through the shared message format', async () => {
    state.calls.length = 0;
    const generate = createGenerate(
      readConfig({ MODEL_PROVIDER: 'groq', GROQ_API_KEY: 'fixture', TAVILY_API_KEY: 'fixture' }),
    );
    const first = await generate(
      '',
      '',
      'System',
      [{ role: 'user', parts: [{ text: 'Check a price' }] }],
      new AbortController().signal,
    );
    expect(first).toMatchObject([
      { functionCall: { id: 'call-1', name: 'web_search', args: { query: 'official pricing' } } },
    ]);
    await generate(
      '',
      '',
      'System',
      [
        { role: 'user', parts: [{ text: 'Check a price' }] },
        { role: 'model', parts: first },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'call-1',
                name: 'web_search',
                response: { results: [{ title: 'Pricing' }] },
              },
            },
          ],
        },
      ],
      new AbortController().signal,
    );
    const messages = state.calls[1]!.messages as Array<{
      tool_calls?: Array<{ id: string }>;
      tool_call_id?: string;
    }>;
    expect(messages[2]?.tool_calls?.[0]?.id).toBe('call-1');
    expect(messages[3]?.tool_call_id).toBe('call-1');
  });

  it('streams OpenAI chunks and selects its configured model', async () => {
    state.calls.length = 0;
    const generate = createGenerate(
      readConfig({
        MODEL_PROVIDER: 'openai',
        OPENAI_API_KEY: 'fixture',
        CHAT_MODEL: 'test-openai-model',
        TAVILY_API_KEY: 'fixture',
      }),
    );
    const deltas: string[] = [];
    const result = await generate(
      '',
      '',
      'System',
      [{ role: 'user', parts: [{ text: 'Say hello' }] }],
      new AbortController().signal,
      async (delta) => {
        deltas.push(delta);
      },
    );
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result).toEqual([{ text: 'Hello' }]);
    expect(state.calls[0]?.model).toBe('test-openai-model');
  });
  it('reassembles a streamed Groq tool call before executing search', async () => {
    const generate = createGenerate(
      readConfig({ MODEL_PROVIDER: 'groq', GROQ_API_KEY: 'fixture', TAVILY_API_KEY: 'fixture' }),
    );
    const result = await generate(
      '',
      '',
      'System',
      [{ role: 'user', parts: [{ text: 'Find pricing' }] }],
      new AbortController().signal,
      async () => {},
    );
    expect(result).toMatchObject([
      { functionCall: { id: 'call-1', name: 'web_search', args: { query: 'official pricing' } } },
    ]);
  });
});
