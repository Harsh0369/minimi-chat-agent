import type { Connection } from '../types.js';
import { Button } from './ui/Button.js';

export function StatusNotice({
  connection,
  onRetry,
  onReset,
}: {
  connection: Connection;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div
      id="preview-note"
      className="mt-7 border-t border-line pt-5 text-[11px] leading-6 text-muted"
    >
      {connection.state === 'expired' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p>
            This browser’s workspace session has expired. Starting again won’t restore its old
            conversations.
          </p>
          <Button onClick={onReset}>Start new workspace</Button>
        </div>
      ) : connection.state === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p>Couldn’t load this workspace. Please try again.</p>
          <Button onClick={onRetry}>Try again</Button>
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
