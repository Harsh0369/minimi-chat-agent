import { Menu, Search } from 'lucide-react';
export function SiteHeader({
  title,
  onMenu,
  menuOpen,
  onSearch,
}: {
  title: string;
  onMenu: () => void;
  menuOpen: boolean;
  onSearch: () => void;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-8">
      <button
        onClick={onMenu}
        aria-label="Open conversations"
        aria-expanded={menuOpen}
        className="grid size-10 shrink-0 place-items-center rounded-lg hover:bg-panel lg:hidden"
      >
        <Menu size={20} />
      </button>
      <span className="truncate text-sm text-muted">{title}</span>
      <button
        onClick={onSearch}
        aria-label="Search chats"
        className="ml-auto grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-panel lg:hidden"
      >
        <Search size={19} />
      </button>
    </header>
  );
}
