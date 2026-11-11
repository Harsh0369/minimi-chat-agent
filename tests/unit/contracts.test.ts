import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { submitMessageSchema } from '../../src/shared/contracts.js';

const message = () => ({
  requestId: randomUUID(),
  text: 'What changed since Tuesday?',
  timezone: 'Asia/Calcutta',
});
describe('message boundary for later conversation routes', () => {
  it('preserves original text instead of rewriting user evidence', () => {
    const input = { ...message(), text: '  my original\nmessage 🙂  ' };
    expect(submitMessageSchema.parse(input).text).toBe(input.text);
  });
  it('rejects forged historical timestamps and extra model instructions', () => {
    expect(
      submitMessageSchema.safeParse({ ...message(), createdAt: '2025-01-01T00:00:00Z' }).success,
    ).toBe(false);
    expect(submitMessageSchema.safeParse({ ...message(), role: 'system' }).success).toBe(false);
  });
  it.each(['', ' \n ', 'a'.repeat(16_001)])('rejects empty or excessive text', (text) => {
    expect(submitMessageSchema.safeParse({ ...message(), text }).success).toBe(false);
  });
  it.each(['Mars/Olympus', '+05:30', 'PST', '', 'America/New_York\n'])(
    'rejects timezone %j',
    (timezone) => {
      expect(submitMessageSchema.safeParse({ ...message(), timezone }).success).toBe(false);
    },
  );
  it.each(['UTC', 'Asia/Kolkata', 'America/New_York', 'Etc/GMT+5'])(
    'accepts named timezone %s',
    (timezone) => {
      expect(submitMessageSchema.safeParse({ ...message(), timezone }).success).toBe(true);
    },
  );
});
