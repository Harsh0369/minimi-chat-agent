import type { Connection } from '../types.js';

export function SiteHeader({ connection }: { connection: Connection }) {
  return (
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
  );
}
