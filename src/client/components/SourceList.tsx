import { ExternalLink } from 'lucide-react';
import type { Source } from '../lib/conversations.js';

export function SourceList({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <details className="group mt-4 border-t border-line pt-3 text-sm">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg text-xs font-medium text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex -space-x-1.5" aria-hidden="true">
          {sources.slice(0, 3).map((source) => (
            <span
              key={source.id}
              className="grid size-6 place-items-center rounded-full border-2 border-paper bg-panel text-[9px] font-semibold text-ink"
            >
              {new URL(source.url).hostname
                .replace(/^www\./, '')
                .slice(0, 1)
                .toUpperCase()}
            </span>
          ))}
        </span>
        {sources.length} {sources.length === 1 ? 'source' : 'sources'}{' '}
        <span className="text-accent group-open:rotate-90">›</span>
      </summary>
      <ol className="mt-3 space-y-2 pb-1">
        {sources.map((source) => (
          <li key={source.id}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2 hover:border-accent"
            >
              <span className="shrink-0 rounded bg-accent-soft px-1.5 text-xs text-accent">
                {source.id.slice(1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink">{source.title}</span>
                <span className="block truncate text-[11px] text-muted">
                  {new URL(source.url).hostname.replace(/^www\./, '')}
                </span>
              </span>
              <ExternalLink size={14} className="mt-1 shrink-0 text-muted" />
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
