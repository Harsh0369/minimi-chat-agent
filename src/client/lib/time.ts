export function formatLocalTime(timestamp: number, timeZone?: string) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(timeZone ? { timeZone } : {}),
  })
    .format(value)
    .replace(/\s+/gu, '')
    .toLowerCase();
}
