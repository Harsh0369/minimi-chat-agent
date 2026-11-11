import { SiteHeader } from './components/SiteHeader.js';
import { Sidebar } from './components/Sidebar.js';
import { PreviewConversation } from './components/PreviewConversation.js';
import { StatusNotice } from './components/StatusNotice.js';
import { SiteFooter } from './components/SiteFooter.js';
import { useServiceStatus } from './hooks/useServiceStatus.js';

export function App() {
  const { connection, retry } = useServiceStatus();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only fixed top-4 left-4 z-50 rounded-lg bg-ink px-4 py-3 text-white focus:not-sr-only"
      >
        Skip to conversation
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-col">
        <SiteHeader connection={connection} />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-[960px] flex-1 flex-col px-6 pt-12 pb-8 sm:px-12 sm:pt-16 xl:pt-20"
        >
          <div className="mb-5 flex items-center gap-3 text-[11px] font-semibold tracking-[0.17em] text-accent uppercase">
            <span className="h-px w-7 bg-accent" aria-hidden="true" /> A little continuity
          </div>
          <h1 className="max-w-[650px] font-editorial text-[42px] leading-[1.08] tracking-[-0.045em] sm:text-[58px] xl:text-[64px]">
            Pick up where
            <br />
            you left off.
          </h1>
          <p className="mt-5 max-w-[490px] text-[15px] leading-7 text-muted">
            Your questions have a history. A good answer should, too. A space to think, revisit, and
            see what’s changed.
          </p>
          <PreviewConversation />
          <StatusNotice connection={connection} onRetry={retry} />
          <SiteFooter />
        </main>
      </div>
    </div>
  );
}
