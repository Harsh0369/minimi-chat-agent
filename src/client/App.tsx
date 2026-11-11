import { SiteHeader } from './components/SiteHeader.js';
import { Sidebar } from './components/Sidebar.js';
import { PreviewConversation } from './components/PreviewConversation.js';
import { StatusNotice } from './components/StatusNotice.js';
import { SiteFooter } from './components/SiteFooter.js';
import { useServiceStatus } from './hooks/useServiceStatus.js';
import { useConversations } from './hooks/useConversations.js';

export function App() {
  const { connection, retry, reset } = useServiceStatus();
  const chats = useConversations(
    connection.state === 'ready' && connection.status.stage === 'agent',
  );
  const enabled =
    connection.state === 'ready' && connection.status.capabilities.chat && Boolean(chats.selected);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only fixed top-4 left-4 z-50 rounded-lg bg-ink px-4 py-3 text-white focus:not-sr-only"
      >
        Skip to conversation
      </a>
      <Sidebar
        conversations={chats.conversations}
        selected={chats.selected}
        onSelect={chats.setSelected}
        onCreate={() => void chats.create()}
        onDelete={(id) => void chats.remove(id)}
      />
      <div className="flex min-w-0 flex-col">
        <SiteHeader />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-[960px] flex-1 flex-col px-6 pt-12 pb-8 sm:px-12 sm:pt-16 xl:pt-20"
        >
          <div className="mb-5 flex items-center gap-3 text-[11px] font-semibold tracking-[0.17em] text-accent uppercase">
            <span className="h-px w-7 bg-accent" aria-hidden="true" /> Your workspace
          </div>
          <h1 className="max-w-[650px] font-editorial text-[42px] leading-[1.08] tracking-[-0.045em] sm:text-[58px] xl:text-[64px]">
            Pick up where
            <br />
            you left off.
          </h1>
          <p className="mt-5 max-w-[490px] text-[15px] leading-7 text-muted">
            Revisit earlier questions and check what has changed.
          </p>
          <PreviewConversation
            messages={chats.messages}
            onSend={chats.send}
            busy={chats.busy}
            enabled={enabled}
            onCancel={() => void chats.cancel()}
          />
          {chats.error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {chats.error}{' '}
              {chats.failedTurn && (
                <button onClick={() => void chats.retry()} className="ml-2 underline">
                  Retry answer
                </button>
              )}
            </p>
          )}
          {!chats.error && chats.failedTurn && (
            <button
              onClick={() => void chats.retry()}
              className="mt-4 self-start text-sm text-accent underline"
            >
              Retry unanswered question
            </button>
          )}
          <StatusNotice connection={connection} onRetry={retry} onReset={reset} />
          <SiteFooter />
        </main>
      </div>
    </div>
  );
}
