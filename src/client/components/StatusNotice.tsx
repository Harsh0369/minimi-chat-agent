import type { Connection } from '../types.js';

export function StatusNotice({
  connection,
  onRetry,
}: {
  connection: Connection;
  onRetry: () => void;
}) {
  return (
    <div id="preview-note" className="notice">
      {connection.state === 'error' ? (
        <>
          <p>Couldn’t reach the local server. Check that it is running, then retry.</p>
          <button className="retry" onClick={onRetry}>
            Retry connection
          </button>
        </>
      ) : (
        <p>Foundation preview · No messages are collected or sent to AI providers.</p>
      )}
    </div>
  );
}
