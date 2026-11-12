// An allowlisted event shape avoids serializing requests, bodies, headers or provider errors.
export type LogEvent =
  | {
      event: 'request_complete';
      requestId: string;
      method: string;
      status: number;
      elapsedMs: number;
    }
  | { event: 'request_error'; requestId: string; status: number; code: string }
  | { event: 'server_started'; origin: string; mode: string }
  | { event: 'server_stopped' }
  | { event: 'startup_error'; code: string }
  | { event: 'model_call_timing'; elapsedMs: number; outcome: 'ok' | 'error' }
  | { event: 'web_search_timing'; elapsedMs: number; outcome: 'ok' | 'error'; resultCount: number };
export type Logger = (event: LogEvent) => void;
export const log: Logger = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
