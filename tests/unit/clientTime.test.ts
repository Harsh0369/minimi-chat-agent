import { describe, expect, it } from 'vitest';
import { formatLocalTime } from '../../src/client/lib/time.js';

describe('local chat timestamps', () => {
  it('uses a compact lowercase 12-hour clock', () => {
    expect(formatLocalTime(Date.UTC(2026, 10, 12, 22, 14), 'UTC')).toBe('10:14pm');
    expect(formatLocalTime(Date.UTC(2026, 10, 12, 0, 0), 'UTC')).toBe('12:00am');
    expect(formatLocalTime(Date.UTC(2026, 10, 12, 12, 5), 'UTC')).toBe('12:05pm');
  });

  it('formats the same instant in the selected local timezone', () => {
    expect(formatLocalTime(Date.UTC(2026, 10, 12, 16, 44), 'Asia/Kolkata')).toBe('10:14pm');
  });
});
