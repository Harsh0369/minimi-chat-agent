import { Brand } from './Brand.js';

export function SiteHeader() {
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
    </header>
  );
}
