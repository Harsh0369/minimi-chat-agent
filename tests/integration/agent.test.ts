import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../../src/server/storage/store.js';
import type { StorePort } from '../../src/server/storage/client.js';
import { readConfig } from '../../src/server/config.js';
import { answer } from '../../src/server/agent/service.js';

const now = Date.UTC(2026, 10, 11, 12);
const config = readConfig({ GEMINI_API_KEY: 'fixture', TAVILY_API_KEY: 'fixture' });
function fixture() {
  const store = createStore(':memory:', now);
  const port = {
    available: true,
    call: async (operation: keyof typeof store.operations, ...args: never[]) => {
      const fn = store.operations[operation] as (...values: never[]) => unknown;
      return fn(...args);
    },
  } as StorePort;
  const owner = store.operations.createSession('hash', now, now + 10000).ownerId;
  const conversation = store.operations.createConversation(owner, 'New conversation', now);
  return { store, port, owner, conversation };
}
afterEach(() => vi.unstubAllGlobals());

describe('agent execution', () => {
  it('answers missing dated memory without a provider call', async () => {
    const f = fixture();
    const turn = f.store.operations.beginTurn(
      f.owner,
      f.conversation.id,
      { requestId: randomUUID(), text: 'What did I ask on 3 November?', timezone: 'Asia/Kolkata' },
      now,
    );
    const called = vi.fn();
    vi.stubGlobal('fetch', called);
    const result = await answer(
      config,
      f.port,
      f.owner,
      f.conversation.id,
      'What did I ask on 3 November?',
      turn.userMessageId,
      'Asia/Kolkata',
      now,
      new AbortController().signal,
    );
    expect(result.text).toContain("can't find an earlier question");
    expect(called).not.toHaveBeenCalled();
    f.store.close();
  });
  it('uses only the web_search tool and retains validated source references', async () => {
    const f = fixture();
    const turn = f.store.operations.beginTurn(
      f.owner,
      f.conversation.id,
      { requestId: randomUUID(), text: 'What is the latest Acme pricing?', timezone: 'UTC' },
      now,
    );
    let modelCalls = 0;
    const fetchMock = vi.fn(async (input: string, options: RequestInit) => {
      if (input.includes('generativelanguage')) {
        modelCalls++;
        const body = JSON.parse(String(options.body)) as {
          tools: Array<{ functionDeclarations: Array<{ name: string }> }>;
          contents: Array<{
            parts: Array<{ thoughtSignature?: string; functionResponse?: { id?: string } }>;
          }>;
        };
        expect(body.tools[0]?.functionDeclarations[0]?.name).toBe('web_search');
        expect(body.tools[0]?.functionDeclarations[0]).toMatchObject({
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        });
        if (modelCalls === 2) {
          expect(body.contents[1]?.parts[0]?.thoughtSignature).toBe('opaque-signature');
          expect(body.contents[2]?.parts[0]?.functionResponse?.id).toBe('call-1');
        }
        return Response.json({
          candidates: [
            {
              content: {
                parts:
                  modelCalls === 1
                    ? [
                        {
                          functionCall: {
                            id: 'call-1',
                            name: 'web_search',
                            args: { query: 'Acme pricing official' },
                          },
                          thoughtSignature: 'opaque-signature',
                        },
                      ]
                    : [{ text: 'Acme lists a price [S1, S99]. Unsupported citation [S99].' }],
              },
            },
          ],
        });
      }
      expect(input).toBe('https://api.tavily.com/search');
      expect(JSON.parse(String(options.body))).toMatchObject({
        search_depth: 'basic',
        include_published_date: true,
        max_results: 5,
      });
      return Response.json({
        results: [
          {
            title: 'Acme pricing',
            url: 'https://example.com/pricing',
            content: 'Current price information',
            published_date: null,
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await answer(
      config,
      f.port,
      f.owner,
      f.conversation.id,
      'What is the latest Acme pricing?',
      turn.userMessageId,
      'UTC',
      now,
      new AbortController().signal,
    );
    expect(modelCalls).toBe(2);
    expect(result.text).toContain('[S1]');
    expect(result.text).not.toContain('[S99]');
    expect(result.citations.map((item) => item.url)).toEqual(['https://example.com/pricing']);
    f.store.close();
  });
});
