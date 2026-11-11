import { useEffect, useState } from 'react';
import { serviceStatusSchema, type ServiceStatus } from '../shared/contracts.js';

type Connection =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; status: ServiceStatus };

export function App() {
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

  return (
    <div className="shell">
      <header className="header">
        <a href="/" className="wordmark" aria-label="Thread home">
          <span className="mark" aria-hidden="true">
            t
          </span>
          thread<span className="byline">a minimi challenge</span>
        </a>
        <span className="connection" role="status">
          <span className={`dot ${connection.state}`} />
          {connection.state === 'ready'
            ? 'Local server connected'
            : connection.state === 'error'
              ? 'Connection unavailable'
              : 'Connecting…'}
        </span>
      </header>
      <main id="main" className="main">
        <div className="eyebrow">CONTEXT, CONTINUED</div>
        <h1>
          Pick up where
          <br />
          you left off.
        </h1>
        <p className="intro">
          A place for questions, the context behind them,
          <br className="desktop-break" /> and what has changed since.
        </p>
        <section className="conversation" aria-labelledby="conversation-heading">
          <div className="conversation-top">
            <h2 id="conversation-heading">Your conversation</h2>
            <span className="label">Local preview</span>
          </div>
          <div className="empty-state">
            <span className="empty-mark" aria-hidden="true">
              ↳
            </span>
            <p>No conversations yet.</p>
            <p className="muted">Chat will be available as the next modules are connected.</p>
          </div>
          <label className="sr-only" htmlFor="message">
            Message
          </label>
          <div className="composer">
            <textarea
              id="message"
              disabled
              placeholder="Ask a question or revisit an earlier one…"
              rows={2}
              aria-describedby="preview-note"
            />
            <button disabled aria-label="Send message">
              ↑
            </button>
          </div>
        </section>
        <div id="preview-note" className="notice">
          {connection.state === 'error' ? (
            <>
              <p>Couldn’t reach the local server. Check that it is running, then retry.</p>
              <button
                className="retry"
                onClick={() => {
                  setConnection({ state: 'loading' });
                  setAttempt((value) => value + 1);
                }}
              >
                Retry connection
              </button>
            </>
          ) : (
            <p>Foundation preview · No messages are collected or sent to AI providers.</p>
          )}
        </div>
      </main>
      <footer>
        <span>Built by Harsh Agarwal</span>
        <span>Memory · Time · Evidence</span>
      </footer>
    </div>
  );
}
