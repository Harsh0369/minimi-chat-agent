export function PreviewConversation() {
  return (
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
  );
}
