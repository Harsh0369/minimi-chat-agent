import type { ButtonHTMLAttributes } from 'react';

export function Button({
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-xs font-medium text-ink transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${className}`}
      {...props}
    />
  );
}
