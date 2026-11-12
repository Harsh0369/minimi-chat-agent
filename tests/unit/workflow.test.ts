import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAnswerWorkflow } from '../../src/server/agent/workflow.js';

afterEach(() => vi.unstubAllGlobals());

describe('answer workflow', () => {
  it('keeps web search unavailable for answers grounded entirely in local context', async () => {
    const fetch = vi.fn(async (_input: string, options: RequestInit) => {
      expect(JSON.parse(String(options.body)).tools).toBeUndefined();
      return Response.json({
        candidates: [{ content: { parts: [{ text: 'The date is November 12.' }] } }],
      });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await runAnswerWorkflow(
      'key',
      'model',
      'Use local clock facts.',
      [{ role: 'user', parts: [{ text: 'Current clock: November 12.' }] }],
      [],
      0,
      'search-key',
      new AbortController().signal,
      undefined,
      undefined,
      'gemini',
      [],
      false,
    );
    expect(result.text).toContain('November 12');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('repairs an unsupported uncited web answer once using the actual source', async () => {
    let modelCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, options: RequestInit) => {
        if (input.includes('tavily'))
          return Response.json({
            results: [
              {
                title: 'Official pricing',
                url: 'https://example.com/pricing',
                content: 'The current price is $20 per seat monthly.',
              },
            ],
          });
        modelCalls++;
        const body = JSON.parse(String(options.body)) as { tools?: unknown };
        if (modelCalls === 1)
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    { functionCall: { name: 'web_search', args: { query: 'official pricing' } } },
                  ],
                },
              },
            ],
          });
        if (modelCalls === 2)
          return Response.json({
            candidates: [{ content: { parts: [{ text: 'The current price is $20.' }] } }],
          });
        expect(body.tools).toBeUndefined();
        return Response.json({
          candidates: [{ content: { parts: [{ text: 'The current price is $20 [S1].' }] } }],
        });
      }),
    );
    const result = await runAnswerWorkflow(
      'gemini-key',
      'test-model',
      'Answer accurately.',
      [{ role: 'user', parts: [{ text: 'What is the price?' }] }],
      [],
      0,
      'search-key',
      new AbortController().signal,
    );
    expect(modelCalls).toBe(3);
    expect(result.text).toContain('[S1]');
    expect(result.sources).toMatchObject([{ url: 'https://example.com/pricing' }]);
  });

  it('does not make a repair call when a valid source is already cited', async () => {
    const fetch = vi.fn(async () => {
      return Response.json({
        candidates: [{ content: { parts: [{ text: 'The answer is supported [S1].' }] } }],
      });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await runAnswerWorkflow(
      'gemini-key',
      'test-model',
      'Answer accurately.',
      [{ role: 'user', parts: [{ text: 'What is the price?' }] }],
      [
        {
          id: 'S1',
          title: 'Pricing',
          url: 'https://example.com/pricing',
          excerpt: 'Price details',
          published: null,
          observedAt: '2026-11-12T00:00:00Z',
        },
      ],
      1,
      'search-key',
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.text).toContain('[S1]');
  });

  it('does not present an uncited web answer as verified after repair', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return Response.json({
          candidates: [{ content: { parts: [{ text: 'The price definitely changed.' }] } }],
        });
      }),
    );
    const result = await runAnswerWorkflow(
      'gemini-key',
      'test-model',
      'Answer accurately.',
      [{ role: 'user', parts: [{ text: 'Did the price change?' }] }],
      [
        {
          id: 'S1',
          title: 'Pricing',
          url: 'https://example.com/pricing',
          excerpt: 'Current price only',
          published: null,
          observedAt: '2026-11-12T00:00:00Z',
        },
      ],
      1,
      'search-key',
      new AbortController().signal,
    );
    expect(calls).toBe(2);
    expect(result.text).toContain("couldn't verify");
    expect(result.text).not.toContain('definitely changed');
  });

  it('repairs a comparison answer that omits one requested aspect', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, options: RequestInit) => {
        calls++;
        if (calls === 2)
          expect(String(options.body)).toContain(
            'Alpha: latest product release announcement lacks a linked source',
          );
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text:
                      calls === 1
                        ? 'Alpha pricing [S1].'
                        : 'Alpha pricing [S1]; latest release [S2].',
                  },
                ],
              },
            },
          ],
        });
      }),
    );
    const sources = ['S1', 'S2'].map((id) => ({
      id,
      title: 'Official source',
      url: 'https://example.com',
      excerpt: 'Fixture evidence',
      published: null,
      observedAt: '2026-11-12T00:00:00Z',
    }));
    const result = await runAnswerWorkflow(
      'gemini-key',
      'test-model',
      'Answer accurately.',
      [{ role: 'user', parts: [{ text: 'What changed?' }] }],
      sources,
      2,
      'search-key',
      new AbortController().signal,
      undefined,
      undefined,
      'gemini',
      [
        {
          name: 'Alpha',
          aspects: [
            { label: 'official pricing', sourceIds: ['S1'] },
            { label: 'latest product release announcement', sourceIds: ['S2'] },
          ],
        },
      ],
    );
    expect(calls).toBe(2);
    expect(result.text).toContain('[S2]');
  });
  it('keeps a successful search when a sibling search fails', async () => {
    let modelCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, options: RequestInit) => {
        if (input.includes('tavily')) {
          const query = (JSON.parse(String(options.body)) as { query: string }).query;
          if (query === 'Beta') return new Response('Unavailable', { status: 503 });
          return Response.json({
            results: [
              {
                title: 'Alpha official',
                url: 'https://alpha.example/pricing',
                content: 'Alpha Starter is $20 monthly.',
              },
            ],
          });
        }
        modelCalls++;
        if (modelCalls === 1)
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    { functionCall: { name: 'web_search', args: { query: 'Alpha' } } },
                    { functionCall: { name: 'web_search', args: { query: 'Beta' } } },
                  ],
                },
              },
            ],
          });
        expect(String(options.body)).toContain('"unavailable":true');
        return Response.json({
          candidates: [
            {
              content: {
                parts: [{ text: 'Alpha Starter is $20 monthly [S1]. Beta could not be verified.' }],
              },
            },
          ],
        });
      }),
    );
    const result = await runAnswerWorkflow(
      'key',
      'model',
      'Answer from evidence.',
      [{ role: 'user', parts: [{ text: 'Compare Alpha and Beta.' }] }],
      [],
      0,
      'search-key',
      new AbortController().signal,
    );
    expect(result.text).toContain('Beta could not be verified');
    expect(result.sources).toHaveLength(1);
  });
});
