import { z } from 'zod';

export const streamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), message: z.string() }),
  z.object({ type: z.literal('reset') }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('done'), turnId: z.string(), state: z.string() }),
  z.object({ type: z.literal('error'), message: z.string(), code: z.string() }),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;
export type EmitEvent = (event: StreamEvent) => Promise<void>;

// Shared by the browser NDJSON transport and provider SSE reader. Bytes may split UTF-8
// characters or lines arbitrarily; never assume one network chunk equals one event.
export async function* readLines(body: ReadableStream<Uint8Array>, maxBytes = 1_000_000) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer) yield buffer.replace(/\r$/, '');
        break;
      }
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('STREAM_TOO_LARGE');
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        yield line;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
