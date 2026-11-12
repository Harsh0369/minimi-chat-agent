import { describe, expect, it, vi } from 'vitest';
import { comparisonPlan, inferComparisonPlan } from '../../src/server/agent/comparison.js';
import type { generate } from '../../src/server/agent/model.js';
const history = [
  {
    role: 'user',
    text: 'We shortlisted HubSpot, Pipedrive, Zoho CRM, Freshsales, and Salesforce for a 20-person sales team.',
  },
];
describe('multi-item comparison planning', () => {
  it('recovers the five historical items and both requested aspects', () => {
    const plan = comparisonPlan(
      'On Monday we shortlisted 5 CRM tools. Has any changed pricing or shipped something big since?',
      history,
    );
    expect(plan?.names).toEqual(['HubSpot', 'Pipedrive', 'Zoho CRM', 'Freshsales', 'Salesforce']);
    expect(plan?.queries).toHaveLength(10);
    expect(plan?.queries).toContain('Zoho CRM for a 20-person sales team official pricing');
    expect(plan?.queries).toContain(
      'Salesforce CRM for a 20-person sales team latest product release announcement',
    );
  });
  it('does not invent a shortlist from vague or assistant-only history', () => {
    expect(comparisonPlan('Has pricing changed for any of them?', [])).toBeNull();
    expect(
      comparisonPlan('Has pricing changed for any of them?', [
        { role: 'assistant', text: history[0]!.text },
      ]),
    ).toBeNull();
    expect(comparisonPlan('Hello', history)).toBeNull();
  });
  it('extracts an explicitly recorded bullet-list comparison without depending on one phrasing', async () => {
    const records = [
      { role: 'assistant', text: 'Options we discussed:\n- AlphaDB\n- BetaDB\n- GammaDB' },
    ];
    const model = vi.fn(async () => [
      { text: JSON.stringify({ names: ['AlphaDB', 'BetaDB', 'GammaDB'] }) },
    ]) as unknown as typeof generate;
    const plan = await inferComparisonPlan(
      'Which of those hosting services changed pricing?',
      records,
      model,
      'key',
      'model',
      new AbortController().signal,
    );
    expect(plan?.names).toEqual(['AlphaDB', 'BetaDB', 'GammaDB']);
    expect(plan?.queries).toHaveLength(3);
    const invented = vi.fn(async () => [
      { text: JSON.stringify({ names: ['AlphaDB', 'BetaDB', 'InventedDB'] }) },
    ]) as unknown as typeof generate;
    expect(
      await inferComparisonPlan(
        'Which changed pricing?',
        records,
        invented,
        'key',
        'model',
        new AbortController().signal,
      ),
    ).toBeNull();
  });
});
