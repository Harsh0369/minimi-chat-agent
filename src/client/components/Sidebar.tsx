import { MessageSquare, History, ArrowUpRight } from 'lucide-react';
import { Brand } from './Brand.js';

export function Sidebar() {
  return (
    <aside
      aria-label="Workspace"
      className="hidden min-h-dvh flex-col border-r border-line bg-panel px-6 py-8 lg:flex"
    >
      <Brand />
      <p className="mt-2 ml-[42px] text-[10px] tracking-[0.04em] text-muted">A MINIMI CHALLENGE</p>
      <nav aria-label="Workspace navigation" className="mt-12">
        <a
          href="#main"
          aria-current="page"
          className="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-paper px-3 text-[13px] font-medium shadow-sm"
        >
          <MessageSquare size={16} aria-hidden="true" /> Your conversation{' '}
          <ArrowUpRight size={14} className="ml-auto text-muted" aria-hidden="true" />
        </a>
      </nav>
      <div className="mt-9">
        <div className="flex items-center justify-between text-[10px] font-semibold tracking-[0.13em] text-muted uppercase">
          <span>History</span>
          <History size={14} aria-hidden="true" />
        </div>
        <p className="mt-5 text-[12px] leading-6 text-muted">No conversations yet.</p>
      </div>
      <div className="mt-auto pt-24">
        <p className="border-t border-line pt-5 text-[10px] text-muted">Built by Harsh Agarwal</p>
      </div>
    </aside>
  );
}
