import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Source } from '../lib/conversations.js';

export function MessageText({ text, sources = [] }: { text: string; sources?: Source[] }) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  // Older saved answers included a verbose source appendix. Their source snapshots
  // are now rendered separately, so hide only a matching legacy appendix.
  const body = sources.length
    ? text.replace(/\n\nSources:\n(?:\[S\d+\] [^\n]+ — https:\/\/[^\n]+(?:\n|$))+$/u, '')
    : text;
  const linked = body.replace(/\[S(\d+)\]/g, (match, number: string) => {
    const source = byId.get(`S${number}`);
    if (!source) return match;
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:') return match;
      return `[${number}](${url.toString().replaceAll('(', '%28').replaceAll(')', '%29')})`;
    } catch {
      return match;
    }
  });
  return (
    <div className="message-content min-w-0 break-words">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={/^\d+$/.test(String(children)) ? `Source ${children}` : undefined}
              className={
                /^\d+$/.test(String(children))
                  ? 'ml-0.5 inline-flex min-w-5 items-center justify-center rounded-md bg-accent-soft px-1 text-[11px] font-semibold text-accent no-underline align-baseline hover:underline'
                  : 'text-accent underline underline-offset-2'
              }
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-4 max-w-full overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {linked}
      </Markdown>
    </div>
  );
}
