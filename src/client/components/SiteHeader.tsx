import type { Connection } from '../types.js';
import { Brand } from './Brand.js';

export function SiteHeader({ connection }: { connection: Connection }) {
  return (
    <header className="flex min-h-[80px] items-center justify-between gap-4 border-b border-line px-6 sm:px-12">
      <div className="lg:hidden">
        <Brand />
      </div>
      <div className="hidden items-center gap-3 text-xs lg:flex">
        <span className="text-muted">Workspace</span>
        <span className="text-line">/</span>
        <span>Your conversation</span>
      </div>
      <span role="status" className="flex items-center gap-2 text-[10px] text-muted sm:text-xs">
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${connection.state === 'ready' ? 'bg-success' : connection.state === 'error' ? 'bg-accent' : 'bg-muted'}`}
        />
        {connection.state === 'ready'
          ? 'Local server connected'
          : connection.state === 'error'
            ? 'Connection unavailable'
            : 'Connecting…'}
      </span>
    </header>
  );
}
