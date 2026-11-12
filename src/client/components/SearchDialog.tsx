import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Search, X } from 'lucide-react';
import { request } from '../lib/conversations.js';

type Result = {
  conversations: Array<{ id: string; title: string; updatedAt: number }>;
  messages: Array<{
    messageId: string;
    conversationId: string;
    conversationTitle: string;
    role: string;
    preview: string;
    createdAt: number;
  }>;
};
export function SearchDialog({
  open,
  onClose,
  conversationId,
  onResult,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string | null;
  onResult: (conversationId: string, messageId?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'thread'>('all');
  const [results, setResults] = useState<Result | null>(null);
  const [error, setError] = useState(false);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
    if (!open) {
      setQuery('');
      setResults(null);
      setScope('all');
      setSearching(false);
    }
  }, [open]);
  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    setSearching(true);
    setError(false);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim() });
      if (scope === 'thread' && conversationId) params.set('conversationId', conversationId);
      void request<Result>(`/api/search?${params}`, { signal: controller.signal })
        .then((value) => {
          if (!controller.signal.aborted) {
            setResults(value);
            setError(false);
            setSearching(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setError(true);
            setSearching(false);
          }
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, scope, conversationId]);
  return (
    <dialog
      ref={dialog}
      aria-label="Search conversations"
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] mx-auto max-h-[min(80dvh,640px)] w-[calc(100vw-24px)] max-w-[640px] overflow-hidden rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-black/35 sm:top-[min(9dvh,72px)]"
    >
      <div className="flex max-h-[min(80dvh,640px)] min-h-0 flex-col">
        <div className="flex min-h-14 items-center gap-3 border-b border-line px-4">
          <Search size={19} className="shrink-0 text-muted" />
          <input
            autoFocus
            aria-label="Search chats"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults(null);
            }}
            placeholder="Search chats and messages"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted sm:text-sm"
          />
          <button
            onClick={onClose}
            aria-label="Close search"
            className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-panel"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex gap-2 border-b border-line px-4 py-2 text-xs">
          <button
            onClick={() => {
              setScope('all');
              setResults(null);
            }}
            aria-pressed={scope === 'all'}
            className={`rounded-full px-3 py-1.5 ${scope === 'all' ? 'bg-ink text-white' : 'text-muted hover:bg-panel'}`}
          >
            All chats
          </button>
          {conversationId && (
            <button
              onClick={() => {
                setScope('thread');
                setResults(null);
              }}
              aria-pressed={scope === 'thread'}
              className={`rounded-full px-3 py-1.5 ${scope === 'thread' ? 'bg-ink text-white' : 'text-muted hover:bg-panel'}`}
            >
              This chat
            </button>
          )}
        </div>
        <div
          aria-busy={searching}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:p-3"
        >
          {error ? (
            <p role="alert" className="p-3 text-sm text-red-700">
              Search could not load. Try again.
            </p>
          ) : query.trim().length < 2 ? (
            <p className="p-3 text-sm text-muted">Type at least two characters to search.</p>
          ) : searching ? (
            <p role="status" className="p-3 text-sm text-muted">
              Searching…
            </p>
          ) : results && !results.conversations.length && !results.messages.length ? (
            <p className="p-3 text-sm text-muted">No matches in this workspace.</p>
          ) : null}
          {!!results?.conversations.length && (
            <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Conversations
            </p>
          )}
          {results?.conversations.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onResult(item.id);
                onClose();
              }}
              className="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent"
            >
              <MessageSquare size={17} className="shrink-0 text-muted" />
              <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
            </button>
          ))}
          {!!results?.messages.length && (
            <p className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Messages
            </p>
          )}
          {results?.messages.map((item) => (
            <button
              key={item.messageId}
              onClick={() => {
                onResult(item.conversationId, item.messageId);
                onClose();
              }}
              className="block w-full min-w-0 rounded-lg px-3 py-3 text-left hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className="block truncate text-xs text-muted">
                {item.preview.trim() === item.conversationTitle.trim()
                  ? item.role === 'user'
                    ? 'Your message'
                    : 'Assistant answer'
                  : item.conversationTitle}
              </span>
              <span className="mt-1 block truncate text-sm text-ink">{item.preview}</span>
            </button>
          ))}
        </div>
      </div>
    </dialog>
  );
}
