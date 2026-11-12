import { describe, expect, it, vi } from 'vitest';
import { answerFromHistory } from '../../src/server/agent/historyAnswer.js';
import type { generate } from '../../src/server/agent/model.js';

describe('local historical answers', () => {
  it('passes only other-chat records to a tool-free concise recall call', async () => {
    const model = vi.fn(async (_key, _model, _system, contents, _signal, _emit, options) => {
      expect(options.tools).toBe(false);
      const request = JSON.parse((contents[0].parts[0] as { text: string }).text);
      expect(request.historicalRecords).toHaveLength(1);
      expect(request.historicalRecords[0].conversationTitle).toBe('Rice prices');
      return [{ text: 'In another chat, you discussed rice prices in America.' }];
    }) as unknown as typeof generate;
    const answer = await answerFromHistory(
      model,
      'key',
      'model',
      'What did I discuss elsewhere?',
      [],
      [
        {
          id: 'current',
          role: 'user',
          text: 'Current topic',
          conversationTitle: 'This chat',
          createdAt: 1,
          timezone: 'UTC',
        },
        {
          id: 'other',
          role: 'user',
          text: 'Rice prices in America',
          conversationTitle: 'Rice prices',
          createdAt: 2,
          timezone: 'UTC',
        },
      ],
      [{ id: 'current', role: 'user', text: 'Current topic' }],
      new AbortController().signal,
    );
    expect(answer.text).toContain('rice prices');
  });
});
