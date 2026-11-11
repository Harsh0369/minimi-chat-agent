import { Waypoints } from 'lucide-react';

export function Brand() {
  return (
    <a
      href="/"
      aria-label="Thread home"
      className="inline-flex w-fit items-center gap-2.5 text-ink no-underline"
    >
      <span className="grid size-8 place-items-center rounded-[10px] bg-ink text-paper">
        <Waypoints size={18} strokeWidth={1.6} aria-hidden="true" />
      </span>
      <span className="text-[23px] font-semibold tracking-[-1.1px]">
        thread<span className="text-accent">.</span>
      </span>
    </a>
  );
}
