import type { Connection } from '../types.js';
import { Button } from './ui/Button.js';

export function StatusNotice({
  connection,
  onRetry,
}: {
  connection: Connection;
  onRetry: () => void;
}) {
  return (
    <div
      id="preview-note"
      className="mt-7 border-t border-line pt-5 text-[11px] leading-6 text-muted"
    >
      {connection.state === 'error' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>Couldn’t reach the local server. Check that it is running, then retry.</p>
          <Button onClick={onRetry}>Retry connection</Button>
        </div>
      ) : (
        <p>
          <span className="font-medium text-ink">You’re viewing an early preview.</span> Chat is not
          available yet.
          <br />
          No messages are collected or sent to AI providers.
        </p>
      )}
    </div>
  );
}
