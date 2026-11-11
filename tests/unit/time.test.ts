import { describe, expect, it } from 'vitest';
import { mentionedDay } from '../../src/server/agent/time.js';

describe('dated memory boundaries', () => {
  it('resolves a calendar date in the browser timezone', () => {
    const day = mentionedDay(
      'What did I ask on 3 November?',
      Date.UTC(2026, 10, 11),
      'Asia/Kolkata',
    );
    expect(day).toEqual({
      label: '2026-11-03',
      from: Date.UTC(2026, 10, 2, 18, 30),
      to: Date.UTC(2026, 10, 3, 18, 30),
    });
  });
  it('uses a 23-hour day across the New York spring DST boundary', () => {
    const day = mentionedDay('2026-03-08', Date.UTC(2026, 2, 11), 'America/New_York');
    expect(day && (day.to - day.from) / 3600000).toBe(23);
  });
  it('rejects an invalid ISO calendar date', () => {
    expect(mentionedDay('2026-02-30', Date.UTC(2026, 2, 11), 'UTC')).toBeNull();
  });
});
