import { describe, expect, it } from 'vitest';
import { marketContext, marketSearchPlan } from '../../src/server/agent/market.js';
describe('market context', () => {
  it('uses India as a labeled timezone hint for ambiguous local prices', () => {
    const text = marketContext('gold price today', 'Asia/Kolkata');
    expect(text).toContain('India (INR)');
    expect(text).toContain('weak market default');
    expect(marketSearchPlan('What is the gold price today?', 'Asia/Kolkata')?.query).toContain(
      'India INR 24K per 10g',
    );
  });
  it('lets explicit locations override the browser hint', () => {
    expect(marketContext('gold price in Dubai', 'Asia/Kolkata')).not.toContain('India (INR)');
    expect(marketContext('gold price in Berlin', 'Asia/Kolkata')).not.toContain('India (INR)');
    expect(marketSearchPlan('gold price in Berlin', 'Asia/Kolkata')).toBeNull();
    expect(marketSearchPlan('gold price in Dubai', 'Asia/Kolkata')).toBeNull();
  });
  it('asks for market context when timezone is insufficient', () => {
    expect(marketContext('gold price', 'UTC')).toContain('No reliable market');
  });
});
