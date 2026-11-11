const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const months = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function parts(at: number, timezone: string) {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (key: string) => Number(values.find((value) => value.type === key)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function localMidnight(year: number, month: number, day: number, timezone: string) {
  const target = Date.UTC(year, month - 1, day);
  let utc = target;
  for (let i = 0; i < 3; i++) {
    const p = parts(utc, timezone);
    const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    utc += target - local;
  }
  return utc;
}

export function mentionedDay(text: string, now: number, timezone: string) {
  const lower = text.toLowerCase();
  const today = parts(now, timezone);
  let day: Date | undefined;
  const iso = lower.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  const named = lower.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?\b/,
  );
  if (iso) day = new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!));
  else if (named)
    day = new Date(Date.UTC(+(named[3] ?? today.year), months.indexOf(named[2]!), +named[1]!));
  else if (/\byesterday\b/.test(lower))
    day = new Date(Date.UTC(today.year, today.month - 1, today.day - 1));
  else if (/\btoday\b/.test(lower))
    day = new Date(Date.UTC(today.year, today.month - 1, today.day));
  else {
    const match = lower.match(
      /\b(last|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
    );
    if (match) {
      const current = new Date(Date.UTC(today.year, today.month - 1, today.day));
      const desired = weekdays.indexOf(match[2]!);
      let distance = (current.getUTCDay() - desired + 7) % 7;
      if (match[1] === 'last' && distance === 0) distance = 7;
      if (match[1] === 'last' && distance < 7) distance += 7;
      day = new Date(current.getTime() - distance * 86400000);
    }
  }
  if (!day || Number.isNaN(day.getTime())) return null;
  const y = day.getUTCFullYear(),
    m = day.getUTCMonth() + 1,
    d = day.getUTCDate();
  if (iso && (y !== +iso[1]! || m !== +iso[2]! || d !== +iso[3]!)) return null;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    label: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    from: localMidnight(y, m, d, timezone),
    to: localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timezone),
  };
}
