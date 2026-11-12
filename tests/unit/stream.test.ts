import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLines } from '../../src/shared/stream.js';
import { generate } from '../../src/server/agent/model.js';
import { streamTurn } from '../../src/client/lib/conversations.js';
const encode = new TextEncoder();
const chunk = (text: string, finish = false) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...(finish ? { finishReason: 'STOP' } : {}) }] })}\r\n\r\n`;
afterEach(() => vi.unstubAllGlobals());
describe('streaming transport', () => {
  it('decodes split UTF-8, CRLF, and a final unterminated line', async () => {
    const bytes = encode.encode('héllo\r\n世界\nlast');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
        c.close();
      },
    });
    const lines = [];
    for await (const line of readLines(body)) lines.push(line);
    expect(lines).toEqual(['héllo', '世界', 'last']);
  });
  it('cancels oversized streams', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encode.encode('12345'));
      },
      cancel,
    });
    await expect(async () => {
      for await (const _line of readLines(body, 3)) {
        /* exhaust */
      }
    }).rejects.toThrow('STREAM_TOO_LARGE');
    expect(cancel).toHaveBeenCalled();
  });
  it('delivers provider text before generation finishes and joins chunks without inserted newlines', async () => {
    let push!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        push = c;
        c.enqueue(encode.encode(chunk('Hello ')));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body)),
    );
    const received: string[] = [];
    let done = false;
    const result = generate(
      'fixture',
      'fixture',
      'system',
      [],
      new AbortController().signal,
      async (text) => {
        received.push(text);
      },
    ).then((parts) => {
      done = true;
      return parts;
    });
    await vi.waitFor(() => expect(received).toEqual(['Hello ']));
    expect(done).toBe(false);
    push.enqueue(encode.encode(chunk('world', true)));
    push.close();
    expect((await result).map((part) => part.text).join('')).toBe('Hello world');
  });
  it('rejects truncated and safety-blocked generations', async () => {
    for (const payload of [
      chunk('incomplete'),
      'data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n',
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(payload)),
      );
      await expect(
        generate('fixture', 'fixture', '', [], new AbortController().signal, async () => {}),
      ).rejects.toThrow();
    }
  });
  it('preserves tool call IDs and thought signatures while hiding thoughts', async () => {
    const parts = [
      { text: 'private reasoning', thought: true },
      {
        functionCall: { id: 'call1', name: 'web_search', args: { query: 'pricing' } },
        thoughtSignature: 'signature',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            `data: ${JSON.stringify({ candidates: [{ content: { parts }, finishReason: 'STOP' }] })}\n\n`,
          ),
      ),
    );
    const emit = vi.fn();
    expect(
      await generate('fixture', 'fixture', '', [], new AbortController().signal, emit),
    ).toEqual(parts);
    expect(emit).not.toHaveBeenCalled();
  });
  it('requires a completion event and propagates safe server errors', async () => {
    for (const [payload, expected] of [
      ['{"type":"delta","text":"partial"}\n', 'connection ended'],
      [
        '{"type":"error","code":"AGENT_FAILED","message":"Retry this answer."}\n',
        'Retry this answer.',
      ],
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(payload, { headers: { 'Content-Type': 'application/x-ndjson' } }),
        ),
      );
      await expect(
        streamTurn('/fixture', {}, new AbortController().signal, () => {}),
      ).rejects.toThrow(expected);
    }
  });
});
