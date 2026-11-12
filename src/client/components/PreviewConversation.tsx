import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, ArrowDown, Square, Copy, Check, Pencil } from 'lucide-react';
import type { ChatMessage } from '../hooks/useConversations.js';
import { MessageText } from './MessageText.js';
import { SourceList } from './SourceList.js';
import { formatLocalTime } from '../lib/time.js';
export function PreviewConversation({
  messages,
  onSend,
  onEdit,
  busy,
  enabled,
  onCancel,
  partial,
  progress,
  loading,
  focusedMessageId,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<void>;
  onEdit: (messageId: string, text: string) => Promise<void>;
  busy: boolean;
  enabled: boolean;
  onCancel: () => void;
  partial: string;
  progress: string;
  loading: boolean;
  focusedMessageId?: string | null;
}) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const following = useRef(true);
  const userScrolling = useRef(false);
  const frame = useRef<number | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedId(message.id);
      setCopyError(false);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopyError(true);
    }
  };
  const saveEdit = (messageId: string) => {
    const text = editDraft.trim();
    if (!text || busy || !enabled) return;
    setEditingId(null);
    following.current = true;
    void onEdit(messageId, text);
  };
  const scheduleFollow = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const node = viewport.current;
      if (node && following.current) node.scrollTop = node.scrollHeight;
    });
  };
  const jump = () => {
    const node = viewport.current;
    following.current = true;
    userScrolling.current = false;
    if (node)
      node.scrollTo({
        top: node.scrollHeight,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    setShowLatest(false);
  };
  useEffect(() => {
    if (following.current) scheduleFollow();
  }, [messages, partial]);
  useEffect(() => {
    const node = content.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (following.current) scheduleFollow();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
  }, []);
  useEffect(() => {
    if (!focusedMessageId || !messages.some((message) => message.id === focusedMessageId)) return;
    const target = [
      ...(viewport.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []),
    ].find((node) => node.dataset.messageId === focusedMessageId);
    following.current = false;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setShowLatest(true);
  }, [focusedMessageId, messages]);
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
        onWheel={(event) => {
          userScrolling.current = true;
          if (event.deltaY < 0) {
            following.current = false;
            setShowLatest(true);
          }
        }}
        onTouchMove={() => {
          userScrolling.current = true;
        }}
        onPointerDown={() => {
          userScrolling.current = true;
        }}
        onKeyDown={(event) => {
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
            userScrolling.current = true;
            following.current = false;
            setShowLatest(true);
          }
        }}
        onScroll={() => {
          const node = viewport.current;
          if (node) {
            const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            if (atBottom) {
              following.current = true;
              userScrolling.current = false;
              setShowLatest(false);
            } else if (userScrolling.current) {
              following.current = false;
              setShowLatest(true);
            }
          }
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-6 [overflow-anchor:none] [scrollbar-width:thin]"
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
        <div ref={content} className="flex flex-col gap-7 px-1">
          {messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === 'user'
                  ? 'group ml-auto flex max-w-[90%] flex-col items-end sm:max-w-[80%]'
                  : 'group min-w-0'
              }
            >
              <article
                data-message-id={message.id}
                aria-label={message.role === 'user' ? 'Your message' : 'Assistant message'}
                className={
                  message.role === 'user'
                    ? `max-w-full rounded-2xl bg-ink px-4 py-3 text-sm leading-7 whitespace-pre-wrap break-words text-white ${focusedMessageId === message.id ? 'ring-2 ring-accent ring-offset-2' : ''}`
                    : `min-w-0 text-[15px] leading-7 text-ink ${focusedMessageId === message.id ? 'rounded-xl bg-accent-soft p-3' : ''}`
                }
              >
                {editingId === message.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveEdit(message.id);
                    }}
                    className="min-w-[min(70vw,420px)]"
                  >
                    <label htmlFor={`edit-${message.id}`} className="sr-only">
                      Edit your message
                    </label>
                    <textarea
                      id={`edit-${message.id}`}
                      autoFocus
                      rows={3}
                      maxLength={16000}
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setEditingId(null);
                        if (
                          event.key === 'Enter' &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      className="w-full resize-y rounded-lg bg-white p-3 text-ink outline-none"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="cursor-pointer rounded-lg px-3 py-1.5 hover:bg-white/15"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!editDraft.trim() || busy || !enabled}
                        className="cursor-pointer rounded-lg bg-white px-3 py-1.5 text-ink disabled:opacity-50"
                      >
                        Send
                      </button>
                    </div>
                  </form>
                ) : message.role === 'user' ? (
                  message.text
                ) : (
                  <>
                    <MessageText text={message.text} sources={message.sources ?? []} />
                    <SourceList sources={message.sources ?? []} />
                  </>
                )}
              </article>
              {editingId !== message.id && (
                <div className="mt-1 flex min-h-8 items-center gap-1">
                  <time
                    dateTime={new Date(message.createdAt).toISOString()}
                    title={new Date(message.createdAt).toLocaleString()}
                    className="px-1 text-[11px] text-muted"
                  >
                    {formatLocalTime(message.createdAt)}
                  </time>
                  <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => void copyMessage(message)}
                      aria-label={copiedId === message.id ? 'Copied' : 'Copy message'}
                      title={copiedId === message.id ? 'Copied' : 'Copy'}
                      className="grid size-8 cursor-pointer place-items-center rounded-lg text-muted hover:bg-accent-soft hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {copiedId === message.id ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                    {message.role === 'user' && (
                      <button
                        type="button"
                        disabled={busy || !enabled}
                        onClick={() => {
                          setEditingId(message.id);
                          setEditDraft(message.text);
                        }}
                        aria-label="Edit message"
                        title="Edit message"
                        className="grid size-8 cursor-pointer place-items-center rounded-lg text-muted hover:bg-accent-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {copyError && (
            <p role="alert" className="text-xs text-red-700">
              Could not copy this message. Check clipboard access.
            </p>
          )}
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
              className="grid size-10 cursor-pointer place-items-center rounded-xl bg-ink text-white"
            >
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!enabled || !draft.trim()}
              aria-label="Send message"
              className="grid size-10 cursor-pointer place-items-center rounded-xl bg-accent text-white disabled:bg-accent-soft disabled:text-accent"
            >
              <ArrowUp size={20} />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
