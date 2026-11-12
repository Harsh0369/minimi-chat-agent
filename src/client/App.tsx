import { useCallback, useState } from 'react';
import { MobileDrawer } from './components/MobileDrawer.js';
import { SiteHeader } from './components/SiteHeader.js';
import { Sidebar } from './components/Sidebar.js';
import { PreviewConversation } from './components/PreviewConversation.js';
import { StatusNotice } from './components/StatusNotice.js';

import { useServiceStatus } from './hooks/useServiceStatus.js';
import { useConversations } from './hooks/useConversations.js';

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const { connection, retry, reset } = useServiceStatus();
  const chats = useConversations(
    connection.state === 'ready' && connection.status.stage === 'agent',
  );
  const enabled =
    connection.state === 'ready' && connection.status.capabilities.chat && !chats.loading;
  const sidebar = (
    <Sidebar
      enabled={connection.state === 'ready'}
      conversations={chats.conversations}
      selected={chats.selected}
      onSelect={(id) => {
        chats.setSelected(id);
        closeMenu();
      }}
      onCreate={() => {
        void chats.create();
        closeMenu();
      }}
      onDelete={(id) => void chats.remove(id)}
    />
  );
  return (
    <div className="h-dvh overflow-hidden lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only fixed top-4 left-4 z-50 rounded-lg bg-ink px-4 py-3 text-white focus:not-sr-only"
      >
        Skip to conversation
      </a>
      <div className="hidden h-full overflow-hidden lg:block">{sidebar}</div>
      <MobileDrawer open={menuOpen} onClose={closeMenu}>
        {sidebar}
      </MobileDrawer>
      <div className="flex h-dvh min-h-0 min-w-0 flex-col">
        <SiteHeader
          title={
            chats.conversations.find((item) => item.id === chats.selected)?.title ??
            'New conversation'
          }
          onMenu={() => setMenuOpen(true)}
          menuOpen={menuOpen}
        />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto flex min-h-0 w-full max-w-[960px] flex-1 flex-col px-4 pb-4 sm:px-8"
        >
          <PreviewConversation
            key={chats.selected ?? 'new'}
            partial={chats.partial}
            progress={chats.progress}
            loading={chats.loading}
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
        </main>
      </div>
    </div>
  );
}
