import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const changed = () => {
      if (query.matches) onClose();
    };
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, [onClose]);
  return (
    <dialog
      ref={dialog}
      aria-label="Conversations"
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-0 h-dvh max-h-none w-[min(320px,88vw)] max-w-none border-0 bg-panel p-0 text-ink backdrop:bg-black/30"
    >
      <div className="relative h-full">
        <button
          autoFocus
          onClick={onClose}
          aria-label="Close conversations"
          className="absolute top-5 right-4 z-10 grid size-10 place-items-center rounded-lg hover:bg-paper"
        >
          <X size={20} />
        </button>
        {open ? children : null}
      </div>
    </dialog>
  );
}
