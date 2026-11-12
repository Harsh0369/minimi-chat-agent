import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../../src/server/storage/store.js';
import type { StorePort } from '../../src/server/storage/client.js';
import { readConfig } from '../../src/server/config.js';
import { answer } from '../../src/server/agent/service.js';

const now = Date.UTC(2026, 10, 11, 12);
const config = readConfig({ GEMINI_API_KEY: 'fixture', TAVILY_API_KEY: 'fixture' });
function routerReply(
  options: RequestInit,
  scope: 'THREAD' | 'WORKSPACE',
  needsClock = false,
  clockZones: string[] = [],
) {
  const body = JSON.parse(String(options.body)) as { tools?: unknown };
  return body.tools === undefined && String(options.body).includes('Choose the context')
    ? Response.json({
        candidates: [
          { content: { parts: [{ text: JSON.stringify({ scope, needsClock, clockZones }) }] } },
        ],
      })
    : null;
}
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
  it('keeps a date follow-up in its chat even when another chat discusses rice prices', async () => {
    const f = fixture();
    const first = f.store.operations.beginTurn(
      f.owner,
      f.conversation.id,
      { requestId: randomUUID(), text: "today's date?", timezone: 'Asia/Kolkata' },
      now,
    );
    f.store.operations.stopTurn(f.owner, f.conversation.id, first.id, 'cancelled', now);
    const other = f.store.operations.createConversation(f.owner, 'Rice prices', now);
    f.store.operations.beginTurn(
      f.owner,
      other.id,
      { requestId: randomUUID(), text: 'rice prices in America', timezone: 'Asia/Kolkata' },
      now,
    );
    const followUp = f.store.operations.beginTurn(
      f.owner,
      f.conversation.id,
      { requestId: randomUUID(), text: 'in America?', timezone: 'Asia/Kolkata' },
      now,
    );
    let mainPrompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, options: RequestInit) => {
        const routing = routerReply(options, 'THREAD', true, [
          'America/New_York',
          'America/Los_Angeles',
          'Pacific/Honolulu',
        ]);
        if (routing) return routing;
        mainPrompt = String(options.body);
        return Response.json({
          candidates: [
            { content: { parts: [{ text: 'The date depends on the U.S. time zone.' }] } },
          ],
        });
      }),
    );
    const result = await answer(
      config,
      f.port,
      f.owner,
      f.conversation.id,
      'in America?',
      followUp.userMessageId,
      'Asia/Kolkata',
      now,
      new AbortController().signal,
    );
    expect(result.text).toContain('time zone');
    expect(result.text).not.toMatch(/rice|price/i);
    expect(mainPrompt).toContain("today's date?");
    expect(mainPrompt).not.toContain('rice prices');
    expect(mainPrompt).toContain('America/New_York');
    f.store.close();
  });
  it('keeps unrelated cross-chat history out of an ordinary follow-up prompt', async () => {
    const f = fixture();
    const first = f.store.operations.beginTurn(
      f.owner,
      f.conversation.id,
      { requestId: randomUUID(), text: 'How does our deployment work?', timezone: 'UTC' },
      now,
    );
    f.store.operations.stopTurn(f.owner, f.conversation.id, first.id, 'cancelled', now);
    const other = f.store.operations.createConversation(f.owner, 'Rice prices', now);
    f.store.operations.beginTurn(
      f.owner,
      other.id,
      { requestId: randomUUID(), text: 'Rice prices in the US', timezone: 'UTC' },
      now,
    );
    const followUp = f.store.operations.beginTurn(
      f.owner,
      f.conversation.id,
      { requestId: randomUUID(), text: 'What about in America?', timezone: 'UTC' },
      now,
    );
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, options: RequestInit) => {
        expect(input).toContain('generativelanguage');
        const routing = routerReply(options, 'THREAD');
        if (routing) return routing;
        prompt = String(options.body);
        return Response.json({
          candidates: [{ content: { parts: [{ text: 'Which deployment aspect do you mean?' }] } }],
        });
      }),
    );
    const result = await answer(
      config,
      f.port,
      f.owner,
      f.conversation.id,
      'What about in America?',
      followUp.userMessageId,
      'UTC',
      now,
      new AbortController().signal,
    );
    expect(result.text).toContain('deployment');
    expect(prompt).toContain('How does our deployment work?');
    expect(prompt).not.toContain('Rice prices');
    f.store.close();
  });
  it('recalls an explicitly requested day from another chat', async () => {
    const f = fixture();
    const other = f.store.operations.createConversation(f.owner, 'Postgres research', now);
    f.store.operations.beginTurn(
      f.owner,
      other.id,
      {
        requestId: randomUUID(),
        text: 'Which Postgres hosting option is cheapest?',
        timezone: 'UTC',
      },
      Date.UTC(2026, 10, 3, 12),
    );
    const question = 'What did I ask on 3 November?';
    const turn = f.store.operations.beginTurn(
      f.owner,
      f.conversation.id,
      { requestId: randomUUID(), text: question, timezone: 'UTC' },
      now,
    );
    let prompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, options: RequestInit) => {
        const routing = routerReply(options, 'WORKSPACE');
        if (routing) return routing;
        prompt = String(options.body);
        return Response.json({
          candidates: [{ content: { parts: [{ text: 'You asked about Postgres hosting.' }] } }],
        });
      }),
    );
    const result = await answer(
      config,
      f.port,
      f.owner,
      f.conversation.id,
      question,
      turn.userMessageId,
      'UTC',
      now,
      new AbortController().signal,
    );
    expect(result.text).toContain('Postgres hosting');
    expect(prompt).toContain('Which Postgres hosting option is cheapest?');
    f.store.close();
  });
  it('retrieves a dated answer and its source snapshot before rechecking current facts', async () => {
    const f = fixture();
    const oldAt = Date.UTC(2026, 10, 3, 12);
    const other = f.store.operations.createConversation(f.owner, 'Postgres research', oldAt);
    const old = f.store.operations.beginTurn(
      f.owner,
      other.id,
      { requestId: randomUUID(), text: 'What is the Neon Launch plan price?', timezone: 'UTC' },
      oldAt,
    );
    f.store.operations.startTurn(f.owner, other.id, old.id, oldAt);
    f.store.operations.completeTurn(f.owner, other.id, old.id, 'It was usage based [S1].', oldAt, [
      {
        id: 'S1',
        title: 'Neon Pricing',
        url: 'https://neon.com/pricing',
        excerpt: 'Launch is usage based.',
        published: null,
        observedAt: new Date(oldAt).toISOString(),
      },
    ]);
    const question = 'What did I ask on 3 November? Is your answer still correct today?';
    const turn = f.store.operations.beginTurn(
      f.owner,
      f.conversation.id,
      { requestId: randomUUID(), text: question, timezone: 'UTC' },
      now,
    );
    let sawSnapshot = false;
    let modelCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, options: RequestInit) => {
        if (input.includes('tavily'))
          return Response.json({
            results: [
              {
                title: 'Neon Pricing',
                url: 'https://neon.com/pricing',
                content: 'Launch is usage based.',
              },
            ],
          });
        const body = String(options.body);
        if (body.includes('Choose the context'))
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        scope: 'WORKSPACE',
                        needsClock: false,
                        clockZones: [],
                        webPolicy: 'ALLOW',
                        answerBasis: 'EXTERNAL',
                      }),
                    },
                  ],
                },
              },
            ],
          });
        if (body.includes('You are an evidence auditor'))
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        answer:
                          'On 3 November you asked about Neon Launch pricing. The usage-based description remains consistent with the current page [S1].',
                      }),
                    },
                  ],
                },
              },
            ],
          });
        sawSnapshot ||=
          body.includes('historicalSourceSnapshots') && body.includes('Launch is usage based.');
        modelCalls++;
        return Response.json({
          candidates: [
            {
              content: {
                parts:
                  modelCalls === 1
                    ? [
                        {
                          functionCall: {
                            name: 'web_search',
                            args: { query: 'Neon Launch official pricing' },
                          },
                        },
                      ]
                    : [
                        {
                          text: 'On 3 November you asked about Neon Launch pricing. The current page is usage based [S1].',
                        },
                      ],
              },
            },
          ],
        });
      }),
    );
    const result = await answer(
      config,
      f.port,
      f.owner,
      f.conversation.id,
      question,
      turn.userMessageId,
      'UTC',
      now,
      new AbortController().signal,
    );
    expect(sawSnapshot).toBe(true);
    expect(result.text).toContain('3 November');
    expect(result.citations).toHaveLength(1);
    f.store.close();
  });
  it('asks for a city before searching for an unspecified temperature', async () => {
    const f = fixture();
    const question = "What's today's temp?";
    const turn = f.store.operations.beginTurn(
      f.owner,
      f.conversation.id,
      { requestId: randomUUID(), text: question, timezone: 'Asia/Kolkata' },
      now,
    );
    const called = vi.fn();
    vi.stubGlobal('fetch', called);
    const result = await answer(
      config,
      f.port,
      f.owner,
      f.conversation.id,
      question,
      turn.userMessageId,
      'Asia/Kolkata',
      now,
      new AbortController().signal,
    );
    expect(result).toEqual({ text: 'Which city or location should I check?', citations: [] });
    expect(called).not.toHaveBeenCalled();
    f.store.close();
  });
  it('answers missing dated memory after routing, without an answer-model call', async () => {
    const f = fixture();
    const turn = f.store.operations.beginTurn(
      f.owner,
      f.conversation.id,
      { requestId: randomUUID(), text: 'What did I ask on 3 November?', timezone: 'Asia/Kolkata' },
      now,
    );
    const called = vi.fn(async (_input: string, options: RequestInit) => {
      const routing = routerReply(options, 'WORKSPACE');
      if (routing) return routing;
      throw new Error('Unexpected answer-model call');
    });
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
    expect(result.text).toContain("couldn't find an earlier message");
    expect(called).toHaveBeenCalledTimes(1);
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
        if (String(options.body).includes('You are an evidence auditor'))
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        answer: 'Acme lists current price information [S1].',
                      }),
                    },
                  ],
                },
              },
            ],
          });
        const routing = routerReply(options, 'THREAD');
        if (routing) return routing;
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
                    : [
                        {
                          text: 'Acme lists a price [S1, S99]. Unsupported citation [S99]. Internal [123e4567-e89b-12d3-a456-426614174000].',
                        },
                      ],
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
    expect(result.text).not.toContain('123e4567-e89b-12d3-a456-426614174000');
    expect(result.citations.map((item) => item.url)).toEqual(['https://example.com/pricing']);
    f.store.close();
  });
  it('covers ten independent vendor checks with at most three searches in flight', async () => {
    const f = fixture();
    const shortlist = f.store.operations.createConversation(f.owner, 'CRM shortlist', now);
    f.store.operations.beginTurn(
      f.owner,
      shortlist.id,
      {
        requestId: randomUUID(),
        text: 'We shortlisted Alpha, Beta, Gamma, Delta, Epsilon for a sales team.',
        timezone: 'UTC',
      },
      Date.UTC(2026, 10, 9, 12),
    );
    const question =
      'On Monday we shortlisted five CRM tools. Have pricing or major releases changed?';
    const turn = f.store.operations.beginTurn(
      f.owner,
      f.conversation.id,
      { requestId: randomUUID(), text: question, timezone: 'UTC' },
      now,
    );
    let modelCalls = 0,
      inFlight = 0,
      peak = 0,
      searches = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, options: RequestInit) => {
        if (input.includes('generativelanguage')) {
          if (String(options.body).includes('You are an evidence examiner'))
            return Response.json({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          items: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map(
                            (name, index) => ({
                              name,
                              aspects: [
                                {
                                  label: 'official pricing',
                                  finding: 'Current pricing page found.',
                                  sourceIds: [`S${index * 2 + 1}`],
                                  changedSinceReference: false,
                                },
                                {
                                  label: 'latest product release announcement',
                                  finding: 'Current release page found.',
                                  sourceIds: [`S${index * 2 + 2}`],
                                  changedSinceReference: false,
                                },
                              ],
                            }),
                          ),
                        }),
                      },
                    ],
                  },
                },
              ],
            });
          if (String(options.body).includes('You are an evidence auditor'))
            return Response.json({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          answer:
                            'Current results: Alpha [S1] [S2]; Beta [S3] [S4]; Gamma [S5] [S6]; Delta [S7] [S8]; Epsilon [S9] [S10]. Historical changes cannot be verified without a prior baseline.',
                        }),
                      },
                    ],
                  },
                },
              ],
            });
          const routing = routerReply(options, 'WORKSPACE');
          if (routing) return routing;
          modelCalls++;
          const body = JSON.parse(String(options.body)) as {
            tools: Array<{ functionDeclarations: Array<{ name: string }> }>;
            contents: unknown[];
          };
          expect(body.tools[0]?.functionDeclarations.map((tool) => tool.name)).toEqual([
            'web_search',
          ]);
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'Alpha pricing [S1], release [S2]; Beta pricing [S3], release [S4]; Gamma pricing [S5], release [S6]; Delta pricing [S7], release [S8]; Epsilon pricing [S9], release [S10].',
                    },
                  ],
                },
              },
            ],
          });
        }
        searches++;
        inFlight++;
        peak = Math.max(peak, inFlight);
        const query = (JSON.parse(String(options.body)) as { query: string }).query;
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return Response.json({
          results: [
            {
              title: query,
              url: `https://${query.split(' ')[0]!.toLowerCase()}.example/${encodeURIComponent(query)}`,
              content: 'Fixture evidence',
            },
          ],
        });
      }),
    );
    try {
      const result = await answer(
        config,
        f.port,
        f.owner,
        f.conversation.id,
        question,
        turn.userMessageId,
        'UTC',
        now,
        new AbortController().signal,
      );
      expect(modelCalls).toBe(0);
      expect(searches).toBe(10);
      expect(peak).toBeLessThanOrEqual(3);
      expect(result.citations).toHaveLength(10);
    } finally {
      f.store.close();
    }
  });
});
