import { MessageSquare, Plus, Search, Trash2 } from 'lucide-react';
import { Brand } from './Brand.js';

export function Sidebar({
  conversations,
  selected,
  onSelect,
  onCreate,
  onDelete,
  onSearch,
  enabled,
}: {
  enabled: boolean;
  conversations: Array<{ id: string; title: string }>;
  selected: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onSearch: () => void;
}) {
  return (
    <aside
      aria-label="Workspace"
      className="flex h-full min-h-0 flex-col border-r border-line bg-panel px-5 py-6"
    >
      <Brand />
      <button
        disabled={!enabled}
        onClick={onCreate}
        className="mt-7 flex shrink-0 min-h-11 w-full items-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-white"
      >
        <Plus size={17} /> New conversation
      </button>
      <button
        onClick={onSearch}
        className="mt-3 flex min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm text-muted hover:bg-paper"
      >
        <Search size={16} /> Search chats <kbd className="ml-auto text-[10px]">Ctrl K</kbd>
      </button>
      <nav
        aria-label="Conversations"
        className="mt-7 min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]"
      >
        <p className="mb-3 text-[10px] font-semibold tracking-[0.13em] text-muted uppercase">
          History
        </p>
        {!conversations.length && <p className="text-xs text-muted">No conversations yet.</p>}
        {conversations.map((item) => (
          <div
            key={item.id}
            className={`group mb-1 flex items-center rounded-lg ${selected === item.id ? 'bg-paper shadow-sm' : ''}`}
          >
            <button
              aria-current={selected === item.id ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
              className="flex min-w-0 min-h-11 flex-1 items-center gap-2 px-3 text-left text-sm"
            >
              <MessageSquare size={15} className="shrink-0" />
              <span className="truncate">{item.title}</span>
            </button>
            <button
              aria-label={`Delete ${item.title}`}
              onClick={() => onDelete(item.id)}
              className="mr-2 rounded p-2 text-muted hover:text-ink"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </nav>
      <p className="mt-5 shrink-0 border-t border-line pt-5 text-[10px] text-muted">
        Built by Harsh Agarwal
      </p>
    </aside>
  );
}
