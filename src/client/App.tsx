import { SiteHeader } from './components/SiteHeader.js';
import { PreviewConversation } from './components/PreviewConversation.js';
import { StatusNotice } from './components/StatusNotice.js';
import { SiteFooter } from './components/SiteFooter.js';
import { useServiceStatus } from './hooks/useServiceStatus.js';

export function App() {
  const { connection, retry } = useServiceStatus();

  return (
    <div className="shell">
      <SiteHeader connection={connection} />
      <main id="main" className="main">
        <div className="eyebrow">CONTEXT, CONTINUED</div>
        <h1>
          Pick up where
          <br />
          you left off.
        </h1>
        <p className="intro">
          A place for questions, the context behind them,
          <br className="desktop-break" /> and what has changed since.
        </p>
        <PreviewConversation />
        <StatusNotice connection={connection} onRetry={retry} />
      </main>
      <SiteFooter />
    </div>
  );
}
