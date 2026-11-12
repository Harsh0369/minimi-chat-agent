import { afterEach, describe, expect, it, vi } from 'vitest';
import { clockFacts, needsContextRouting, routeContext } from '../../src/server/agent/context.js';

afterEach(() => vi.unstubAllGlobals());

describe('context router', () => {
  it('skips routing for a self-contained first turn but retains it for memory and follow-ups', () => {
    expect(needsContextRouting('What is the current price of a named service?', [])).toBe(false);
    expect(needsContextRouting('What did I ask last week?', [])).toBe(true);
    expect(needsContextRouting('What is the date?', [])).toBe(true);
    expect(
      needsContextRouting('What about this one?', [{ role: 'user', text: 'Earlier topic' }]),
    ).toBe(true);
  });
  it('shows only the active thread, exposes no tools, and validates clock zones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: RequestInit) => {
        const body = JSON.parse(String(options.body)) as {
          contents: Array<{ parts: Array<{ text: string }> }>;
          tools?: unknown;
          generationConfig: { maxOutputTokens: number };
        };
        expect(body.tools).toBeUndefined();
        expect(body.generationConfig.maxOutputTokens).toBe(240);
        expect(body.contents[0]!.parts[0]!.text).toContain('current thread topic');
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: `\`\`\`json\n${JSON.stringify({
                      scope: 'WORKSPACE',
                      needsClock: true,
                      clockZones: ['America/New_York', 'Invalid/Zone'],
                    })}\n\`\`\``,
                  },
                ],
              },
            },
          ],
        });
      }),
    );
    expect(
      await routeContext(
        'key',
        'model',
        'Earlier discussion?',
        [{ role: 'user', text: 'current thread topic' }],
        'Asia/Kolkata',
        new AbortController().signal,
      ),
    ).toEqual({
      scope: 'WORKSPACE',
      needsClock: true,
      clockZones: ['America/New_York'],
      webPolicy: 'FORBID',
      answerBasis: 'GENERAL',
    });
  });
  it('defaults to the active thread when the router output is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ candidates: [{ content: { parts: [{ text: 'Maybe both' }] } }] }),
      ),
    );
    expect(
      await routeContext(
        'key',
        'model',
        'What about there?',
        [],
        'UTC',
        new AbortController().signal,
      ),
    ).toEqual({
      scope: 'THREAD',
      needsClock: false,
      clockZones: [],
      webPolicy: 'ALLOW',
      answerBasis: 'GENERAL',
    });
  });
  it('computes dates from supplied zones at the current instant', () => {
    const facts = clockFacts(Date.UTC(2026, 10, 12, 6), 'Asia/Kolkata', {
      scope: 'THREAD',
      needsClock: true,
      clockZones: ['America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu'],
      webPolicy: 'FORBID',
      answerBasis: 'CLOCK',
    });
    expect(facts?.local.find((item) => item.zone === 'Asia/Kolkata')?.dateTime).toContain(
      'November 12',
    );
    expect(facts?.local.find((item) => item.zone === 'Pacific/Honolulu')?.dateTime).toContain(
      'November 11',
    );
  });
});
