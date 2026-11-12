import { describe, expect, it } from 'vitest';
import { locationClarification } from '../../src/server/agent/location.js';

describe('city-specific location handling', () => {
  it.each(["today's temp", 'weather for today', 'Is it raining near me?', 'AQI in my city'])(
    'asks for a place when %s has none',
    (question) => expect(locationClarification(question, [])).toContain('Which city'),
  );
  it.each(['temperature in Delhi today', 'Delhi weather?', 'air quality near Bilaspur'])(
    'keeps explicit places for %s',
    (question) => expect(locationClarification(question, [])).toBeNull(),
  );
  it('does not ask for a city on a country-level price question', () => {
    expect(locationClarification('gold price today', [])).toBeNull();
  });
  it('uses a recently stated city, but not one buried in old history', () => {
    const city = { role: 'user', text: 'What is the weather in Delhi?' };
    expect(locationClarification('What about tomorrow?', [city])).toBeNull();
    expect(locationClarification('weather tomorrow', [city])).toBeNull();
    expect(
      locationClarification('weather tomorrow', [
        city,
        ...Array.from({ length: 5 }, () => ({ role: 'user', text: 'Other question' })),
      ]),
    ).toContain('Which city');
  });
});
