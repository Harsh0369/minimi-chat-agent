import { ArrowUp, Globe, Clock3, ListFilter, RotateCcw } from 'lucide-react';

const examples = [
  {
    icon: ListFilter,
    title: 'Revisit a shortlist',
    text: 'Have any of those CRM tools changed their pricing?',
    tag: 'Compare over time',
  },
  {
    icon: Clock3,
    title: 'Find an earlier thought',
    text: 'What did I ask you last Tuesday?',
    tag: 'Recall a conversation',
  },
  {
    icon: RotateCcw,
    title: 'Check what’s changed',
    text: 'Is that answer about Postgres hosting still correct?',
    tag: 'Recheck with the web',
  },
];

export function PreviewConversation() {
  return (
    <section aria-labelledby="conversation-heading" className="mt-10 sm:mt-12">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="conversation-heading" className="text-xs font-medium">
          Your conversation
        </h2>
        <span className="rounded-full border border-line px-2.5 py-1 text-[10px] text-muted">
          Preview
        </span>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-[0_6px_30px_-16px_rgba(41,44,48,0.2)] sm:p-5">
        <label htmlFor="message" className="sr-only">
          Message
        </label>
        <textarea
          id="message"
          disabled
          rows={3}
          aria-describedby="preview-note"
          placeholder="What’s on your mind?"
          className="block w-full resize-none border-0 bg-transparent text-[15px] leading-7 text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed"
        />
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-4">
          <span className="flex items-center gap-2 text-[11px] text-muted">
            <Globe size={14} aria-hidden="true" /> Web search &amp; memory{' '}
            <span className="hidden sm:inline">· coming soon</span>
          </span>
          <button
            disabled
            aria-label="Send message"
            className="grid size-10 shrink-0 cursor-not-allowed place-items-center rounded-xl bg-accent-soft text-accent"
          >
            <ArrowUp size={19} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="mt-9 flex items-center gap-3">
        <h3 className="text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
          A few starting points
        </h3>
        <span className="h-px flex-1 bg-line" />
      </div>
      <ul className="mt-4 grid gap-0 sm:grid-cols-3 sm:gap-5">
        {examples.map(({ icon: Icon, title, text, tag }, index) => (
          <li key={title} className="border-b border-line py-4 last:border-0 sm:border-0 sm:py-2">
            <div className="mb-3 flex items-center justify-between text-accent">
              <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
              <span className="font-mono text-[10px] text-muted">0{index + 1}</span>
            </div>
            <p className="text-[13px] font-medium">{title}</p>
            <p className="mt-2 text-[12px] leading-6 text-muted">“{text}”</p>
            <p className="mt-3 text-[10px] text-muted">{tag}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
