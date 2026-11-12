import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, ArrowDown, Square } from 'lucide-react';
import type { ChatMessage } from '../hooks/useConversations.js';
import { MessageText } from './MessageText.js';
export function PreviewConversation({
  messages,
  onSend,
  busy,
  enabled,
  onCancel,
  partial,
  progress,
  loading,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<void>;
  busy: boolean;
  enabled: boolean;
  onCancel: () => void;
  partial: string;
  progress: string;
  loading: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [showLatest, setShowLatest] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const following = useRef(true);
  const jump = () => {
    const node = viewport.current;
    if (node) node.scrollTop = node.scrollHeight;
    following.current = true;
    setShowLatest(false);
  };
  useEffect(() => {
    if (following.current) jump();
  }, [messages, partial, progress]);
  useEffect(() => {
    const node = input.current;
    if (node) {
      node.style.height = 'auto';
      node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
    }
  }, [draft]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !enabled || busy) return;
    setDraft('');
    following.current = true;
    void onSend(text);
  };
  return (
    <section aria-label="Your conversation" className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={viewport}
        data-testid="transcript"
        tabIndex={0}
        aria-label="Messages"
        onScroll={() => {
          const node = viewport.current;
          if (node) {
            following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
            setShowLatest(!following.current);
          }
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-6 [scrollbar-width:thin]"
      >
        {loading && !messages.length ? (
          <p role="status" className="text-sm text-muted">
            Loading conversation…
          </p>
        ) : !messages.length && !busy ? (
          <div className="flex min-h-full flex-col justify-center py-10 sm:pl-6">
            <h1 className="max-w-xl font-editorial text-[42px] leading-[1.08] tracking-[-0.045em] sm:text-[60px]">
              Pick up where
              <br />
              you left off.
            </h1>
            <p className="mt-5 text-sm leading-7 text-muted">What would you like to explore?</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-7 px-1">
          {messages.map((message) => (
            <article
              key={message.id}
              aria-label={message.role === 'user' ? 'Your message' : 'Assistant message'}
              className={
                message.role === 'user'
                  ? 'ml-auto max-w-[90%] rounded-2xl bg-ink px-4 py-3 text-sm leading-7 whitespace-pre-wrap break-words text-white sm:max-w-[80%]'
                  : 'min-w-0 text-[15px] leading-7 text-ink'
              }
            >
              {message.role === 'user' ? message.text : <MessageText text={message.text} />}
            </article>
          ))}
          {busy && partial && (
            <article aria-label="Answer in progress" className="min-w-0 text-[15px] leading-7">
              <MessageText text={partial} />
            </article>
          )}
          {busy && (
            <p role="status" className="text-xs text-muted">
              {partial ? 'Writing…' : progress}
            </p>
          )}
        </div>
      </div>
      {showLatest && (
        <button
          onClick={jump}
          aria-label="Jump to latest message"
          className="absolute right-3 bottom-32 grid size-10 place-items-center rounded-full border border-line bg-surface shadow-sm"
        >
          <ArrowDown size={18} />
        </button>
      )}
      <form
        onSubmit={submit}
        className="shrink-0 rounded-2xl border border-line bg-surface p-3 shadow-[0_6px_30px_-16px_rgba(41,44,48,0.2)] sm:p-4"
      >
        <label htmlFor="message" className="sr-only">
          Message
        </label>
        <textarea
          ref={input}
          id="message"
          rows={1}
          maxLength={16000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              !window.matchMedia('(pointer: coarse)').matches
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={!enabled}
          placeholder="Ask anything…"
          className="block max-h-40 min-h-7 w-full resize-none border-0 bg-transparent px-1 text-base leading-7 outline-none placeholder:text-muted disabled:cursor-not-allowed"
        />
        <div className="mt-2 flex items-center justify-end">
          {busy ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Stop response"
              className="grid size-10 place-items-center rounded-xl bg-ink text-white"
            >
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!enabled || !draft.trim()}
              aria-label="Send message"
              className="grid size-10 place-items-center rounded-xl bg-accent text-white disabled:bg-accent-soft disabled:text-accent"
            >
              <ArrowUp size={20} />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
