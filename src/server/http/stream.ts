import { once } from 'node:events';
import type { Response } from 'express';
import type { EmitEvent } from '../../shared/stream.js';

export function openStream(res: Response) {
  const disconnected = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) disconnected.abort();
  };
  res.on('close', onClose);
  res
    .status(200)
    .set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    })
    .flushHeaders();
  const emit: EmitEvent = async (event) => {
    disconnected.signal.throwIfAborted();
    if (!res.write(JSON.stringify(event) + '\n')) {
      // Bound slow-client waits as well as provider requests.
      await once(res, 'drain', {
        signal: AbortSignal.any([disconnected.signal, AbortSignal.timeout(5000)]),
      });
    }
  };
  return {
    emit,
    signal: disconnected.signal,
    close() {
      res.end();
      res.off('close', onClose);
    },
  };
}
