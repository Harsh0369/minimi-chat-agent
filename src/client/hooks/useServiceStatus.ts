import { useEffect, useState } from 'react';
import { serviceStatusSchema } from '../../shared/contracts.js';
import type { Connection } from '../types.js';

export function useServiceStatus() {
  const [connection, setConnection] = useState<Connection>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/status', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Service unavailable');
        const status = serviceStatusSchema.parse(await response.json());
        if (active) setConnection({ state: 'ready', status });
      } catch {
        if (active) setConnection({ state: 'error' });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  const retry = () => {
    setConnection({ state: 'loading' });
    setAttempt((value) => value + 1);
  };

  return { connection, retry };
}
