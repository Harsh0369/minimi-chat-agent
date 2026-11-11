import { Worker } from 'node:worker_threads';
import type { StoreOperations } from './store.ts';
import { StoreError } from './errors.ts';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};
export type StorePort = {
  call<K extends keyof StoreOperations>(
    operation: K,
    ...args: Parameters<StoreOperations[K]>
  ): Promise<ReturnType<StoreOperations[K]>>;
  readonly available: boolean;
};

export async function openDatabase(
  path: string,
  options: { now?: number; timeoutMs?: number; maxPending?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxPending = options.maxPending ?? 128;
  const worker = new Worker(
    new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url),
    {
      workerData: { path, now: options.now ?? Date.now() },
      execArgv: [],
    },
  );
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let available = false;
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let startupResolve: () => void;
  let startupReject: (error: Error) => void;
  const started = new Promise<void>((resolve, reject) => {
    startupResolve = resolve;
    startupReject = reject;
  });
  const fail = () => {
    available = false;
    const error = new StoreError('DATABASE_UNAVAILABLE');
    startupReject(error);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
    void worker.terminate();
  };
  const startupTimer = setTimeout(fail, 15_000);
  worker.on('error', fail);
  worker.on('exit', () => {
    clearTimeout(startupTimer);
    if (!closing || pending.size) fail();
    available = false;
  });
  worker.on(
    'message',
    (message: { ready?: boolean; id?: number; ok?: boolean; value?: unknown; code?: string }) => {
      if (message.ready !== undefined) {
        clearTimeout(startupTimer);
        if (!message.ready) {
          fail();
          return;
        }
        available = true;
        startupResolve();
        return;
      }
      const entry = pending.get(message.id!);
      if (!entry) return;
      pending.delete(message.id!);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.value);
      else entry.reject(new StoreError(message.code ?? 'DATABASE_ERROR'));
    },
  );
  await started;
  function dispatch(operation: string, args: unknown[], shutdown = false): Promise<unknown> {
    if (!available || (closing && !shutdown))
      return Promise.reject(new StoreError('DATABASE_UNAVAILABLE'));
    if (!shutdown && pending.size >= maxPending)
      return Promise.reject(new StoreError('DATABASE_BUSY'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(fail, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ id, operation, args });
      } catch {
        fail();
      }
    });
  }
  return {
    get available() {
      return available && !closing;
    },
    async call<K extends keyof StoreOperations>(
      operation: K,
      ...args: Parameters<StoreOperations[K]>
    ): Promise<ReturnType<StoreOperations[K]>> {
      return (await dispatch(operation, args)) as ReturnType<StoreOperations[K]>;
    },
    close(): Promise<void> {
      return (closePromise ??= (async () => {
        closing = true;
        try {
          if (available) await dispatch('close', [], true);
        } finally {
          available = false;
          await worker.terminate();
        }
      })());
    },
    // Forced shutdown rejects queued calls. Mutations are never automatically replayed.
    async forceClose() {
      closing = true;
      fail();
      await worker.terminate();
    },
  };
}
export type DatabaseClient = Awaited<ReturnType<typeof openDatabase>>;
