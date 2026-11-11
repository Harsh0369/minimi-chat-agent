import { useState, type FormEvent } from 'react';
import { ArrowUp, Globe } from 'lucide-react';
import type { ChatMessage } from '../hooks/useConversations.js';

function Text({ value }: { value: string }) {
  return (
    <div className="whitespace-pre-wrap break-words">
      {value.split(/(https:\/\/[^\s)]+)/g).map((piece, index) =>
        piece.startsWith('https://') ? (
          <a
            key={index}
            href={piece}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            {piece}
          </a>
        ) : (
          piece
        ),
      )}
    </div>
  );
}
export function PreviewConversation({
  messages,
  onSend,
  busy,
  enabled,
  onCancel,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<void>;
  busy: boolean;
  enabled: boolean;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !enabled || busy) return;
    setDraft('');
    void onSend(text);
  };
  return (
    <section aria-labelledby="conversation-heading" className="mt-8 flex min-h-0 flex-1 flex-col">
      <h2 id="conversation-heading" className="mb-4 text-xs font-medium">
        Your conversation
      </h2>
      <div
        aria-live="polite"
        className="flex max-h-[55vh] min-h-[160px] flex-col gap-5 overflow-y-auto pb-6"
      >
        {!messages.length && (
          <p className="text-sm leading-7 text-muted">
            Ask a question, revisit an earlier conversation, or check what has changed on the web.
          </p>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`max-w-[90%] rounded-2xl px-5 py-4 text-sm leading-7 ${message.role === 'user' ? 'ml-auto bg-ink text-white' : 'border border-line bg-surface text-ink'}`}
          >
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider opacity-60">
              {message.role === 'user' ? 'You' : 'Assistant'}
            </span>
            <Text value={message.text} />
          </article>
        ))}
        {busy && (
          <div role="status" className="flex items-center gap-4 text-xs text-muted">
            <span>Researching your question…</span>
            <button type="button" onClick={onCancel} className="text-accent underline">
              Cancel
            </button>
          </div>
        )}
      </div>
      <form
        onSubmit={submit}
        className="mt-auto rounded-2xl border border-line bg-surface p-4 shadow-[0_6px_30px_-16px_rgba(41,44,48,0.2)]"
      >
        <label htmlFor="message" className="sr-only">
          Message
        </label>
        <textarea
          id="message"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!enabled || busy}
          placeholder={enabled ? 'Ask anything…' : 'Configure Gemini and Tavily keys to start'}
          className="block w-full resize-none border-0 bg-transparent text-[15px] leading-7 text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed"
        />
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-4">
          <span className="flex items-center gap-2 text-[11px] text-muted">
            <Globe size={14} /> Web search &amp; memory
          </span>
          <button
            type="submit"
            disabled={!enabled || busy || !draft.trim()}
            aria-label="Send message"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-white disabled:cursor-not-allowed disabled:bg-accent-soft disabled:text-accent"
          >
            <ArrowUp size={19} />
          </button>
        </div>
      </form>
    </section>
  );
}
