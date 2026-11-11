import { parentPort, workerData } from 'node:worker_threads';
import { createStore } from './store.ts';
import { StoreError } from './errors.ts';
import { z } from 'zod';

const port = parentPort;
if (!port) throw new Error('Database worker requires a parent');
try {
  const store = createStore(workerData.path as string, workerData.now as number);
  port.on('message', (message: { id: number; operation: string; args: unknown[] }) => {
    try {
      if (message.operation === 'close') {
        store.close();
        port.postMessage({ id: message.id, ok: true, value: null });
        port.close();
        return;
      }
      if (!Object.hasOwn(store.operations, message.operation))
        throw new StoreError('INVALID_OPERATION');
      const operation = store.operations[message.operation as keyof typeof store.operations] as (
        ...args: unknown[]
      ) => unknown;
      const value = operation(...message.args);
      port.postMessage({ id: message.id, ok: true, value });
    } catch (error) {
      const code =
        error instanceof StoreError
          ? error.code
          : error instanceof z.ZodError
            ? 'INVALID_INPUT'
            : 'DATABASE_ERROR';
      port.postMessage({ id: message.id, ok: false, code });
    }
  });
  port.postMessage({ ready: true });
} catch {
  port.postMessage({ ready: false, code: 'DATABASE_UNAVAILABLE' });
  port.close();
}
