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
  if (
    connection.state === 'loading' ||
    (connection.state === 'ready' && connection.status.capabilities.chat)
  )
    return null;
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
      ) : connection.state === 'ready' && !connection.status.capabilities.chat ? (
        <p>
          Set GEMINI_API_KEY and TAVILY_API_KEY in .env, then restart the server to enable chat.
        </p>
      ) : null}
    </div>
  );
}
