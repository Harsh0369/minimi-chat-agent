import { describe, expect, it, vi } from 'vitest';
import { comparisonAnswer } from '../../src/server/agent/comparisonAnswer.js';
import type { generate } from '../../src/server/agent/model.js';

const sources = [
  {
    id: 'S1',
    title: 'Alpha pricing',
    url: 'https://alpha.example/pricing',
    excerpt: '$20 per seat monthly',
    published: null,
    observedAt: '2026-11-12T12:00:00Z',
  },
  {
    id: 'S2',
    title: 'Alpha release',
    url: 'https://alpha.example/releases',
    excerpt: 'A new feature launched in September',
    published: '2026-09-15',
    observedAt: '2026-11-12T12:00:00Z',
  },
];
const coverage = [
  {
    name: 'Alpha',
    aspects: [
      { label: 'official pricing', sourceIds: ['S1'] },
      { label: 'latest product release announcement', sourceIds: ['S2'] },
    ],
  },
];

describe('comparison evidence rendering', () => {
  it('does not turn a current price or an older release into a verified change', async () => {
    const model = vi.fn(async () => [
      {
        text: JSON.stringify({
          items: [
            {
              name: 'Alpha',
              aspects: [
                {
                  label: 'official pricing',
                  finding: '$20 per seat monthly',
                  sourceIds: ['S1'],
                  changedSinceReference: true,
                },
                {
                  label: 'latest product release announcement',
                  finding: 'September release',
                  sourceIds: ['S2'],
                  changedSinceReference: true,
                },
              ],
            },
          ],
        }),
      },
    ]) as unknown as typeof generate;
    const answer = await comparisonAnswer(
      model,
      'key',
      'model',
      'What changed?',
      sources,
      coverage,
      [],
      [],
      '2026-11-12',
      'gemini',
      new AbortController().signal,
    );
    expect(answer).toContain(
      "couldn't verify a pricing change or a newly released feature since 2026-11-12",
    );
    expect(answer).not.toContain('(verified after the earlier discussion)');
    expect(answer).toContain('Alpha');
    expect(answer).toContain('[S1]');
  });
  it('accepts a dated post-reference release while rejecting an unknown source ID', async () => {
    const model = vi.fn(async () => [
      {
        text: JSON.stringify({
          items: [
            {
              name: 'Alpha',
              aspects: [
                {
                  label: 'official pricing',
                  finding: 'Invented rate',
                  sourceIds: ['S99'],
                  changedSinceReference: true,
                },
                {
                  label: 'latest product release announcement',
                  finding: 'New feature',
                  sourceIds: ['S2'],
                  changedSinceReference: true,
                },
              ],
            },
          ],
        }),
      },
    ]) as unknown as typeof generate;
    const answer = await comparisonAnswer(
      model,
      'key',
      'model',
      'What changed?',
      [{ ...sources[0]! }, { ...sources[1]!, published: '2026-11-13' }],
      coverage,
      [],
      [],
      '2026-11-12',
      'gemini',
      new AbortController().signal,
    );
    expect(answer).toContain('I could verify 1 change since 2026-11-12');
    expect(answer).toContain('Pricing: Current evidence unavailable.');
    expect(answer).not.toContain('S99');
  });
  it('drops pricing from a different product line even on the same vendor domain', async () => {
    const model = vi.fn(async () => [
      {
        text: JSON.stringify({
          items: [
            {
              name: 'HubSpot',
              aspects: [
                {
                  label: 'official pricing',
                  finding: 'Marketing Hub costs $25 per month.',
                  sourceIds: ['S1'],
                  changedSinceReference: false,
                },
              ],
            },
          ],
        }),
      },
    ]) as unknown as typeof generate;
    const answer = await comparisonAnswer(
      model,
      'key',
      'model',
      'CRM tools for a sales team: what changed?',
      [
        {
          ...sources[0]!,
          title: 'HubSpot Marketing Hub pricing',
          url: 'https://hubspot.com/marketing/pricing',
        },
      ],
      [{ name: 'HubSpot', aspects: [{ label: 'official pricing', sourceIds: ['S1'] }] }],
      [],
      [],
      '2026-11-12',
      'gemini',
      new AbortController().signal,
    );
    expect(answer).toContain('Pricing: Current evidence unavailable.');
    expect(answer).not.toContain('Marketing Hub costs');
  });
  it('rejects a model-invented amount even when the citation ID exists', async () => {
    const model = vi.fn(async () => [
      {
        text: JSON.stringify({
          items: [
            {
              name: 'Alpha',
              aspects: [
                {
                  label: 'official pricing',
                  finding: 'Starter costs $99 per seat monthly.',
                  sourceIds: ['S1'],
                  changedSinceReference: false,
                },
              ],
            },
          ],
        }),
      },
    ]) as unknown as typeof generate;
    const answer = await comparisonAnswer(
      model,
      'key',
      'model',
      'Alpha pricing?',
      [sources[0]!],
      [{ name: 'Alpha', aspects: [{ label: 'official pricing', sourceIds: ['S1'] }] }],
      [],
      [],
      null,
      'gemini',
      new AbortController().signal,
    );
    expect(answer).toContain('Pricing: Current evidence unavailable.');
    expect(answer).not.toContain('$99');
  });
  it('requires matching dated tier, unit and currency evidence before marking a price change', async () => {
    const model = vi.fn(async () => [
      {
        text: JSON.stringify({
          items: [
            {
              name: 'Alpha',
              aspects: [
                {
                  label: 'official pricing',
                  finding: 'Starter costs $30 per seat monthly.',
                  sourceIds: ['S1'],
                  changedSinceReference: true,
                },
              ],
            },
          ],
        }),
      },
    ]) as unknown as typeof generate;
    const current = [{ ...sources[0]!, excerpt: 'Starter costs $30 per seat monthly.' }];
    const previous = [
      {
        title: 'Alpha Starter pricing',
        url: 'https://alpha.example/pricing',
        excerpt: 'Starter costs $20 per seat monthly.',
        observedAt: '2026-11-10T12:00:00Z',
        published: null,
      },
    ];
    const answer = await comparisonAnswer(
      model,
      'key',
      'model',
      'Alpha pricing?',
      current,
      [{ name: 'Alpha', aspects: [{ label: 'official pricing', sourceIds: ['S1'] }] }],
      previous,
      [],
      '2026-11-11',
      'gemini',
      new AbortController().signal,
    );
    expect(answer).toContain('I could verify 1 change');
    const stale = await comparisonAnswer(
      model,
      'key',
      'model',
      'Alpha pricing?',
      current,
      [{ name: 'Alpha', aspects: [{ label: 'official pricing', sourceIds: ['S1'] }] }],
      [{ ...previous[0]!, observedAt: '2026-11-12T12:00:00Z' }],
      [],
      '2026-11-11',
      'gemini',
      new AbortController().signal,
    );
    expect(stale).toContain("couldn't verify a pricing change");
  });
  it('rejects a sibling product price and a product overview presented as a release', async () => {
    const model = vi.fn(async () => [
      {
        text: JSON.stringify({
          items: [
            {
              name: 'Zoho CRM',
              aspects: [
                {
                  label: 'official pricing',
                  finding: 'Zoho One costs $37 per user monthly.',
                  sourceIds: ['S1'],
                  changedSinceReference: false,
                },
                {
                  label: 'latest product release announcement',
                  finding: 'The product includes AI.',
                  sourceIds: ['S2'],
                  changedSinceReference: false,
                },
              ],
            },
          ],
        }),
      },
    ]) as unknown as typeof generate;
    const answer = await comparisonAnswer(
      model,
      'key',
      'model',
      'CRM tools for a sales team: what shipped?',
      [
        {
          ...sources[0]!,
          title: 'Zoho One pricing',
          url: 'https://www.zoho.com/one/pricing',
          excerpt: 'Zoho One costs $37 per user monthly.',
        },
        {
          ...sources[1]!,
          title: 'Zoho CRM features',
          url: 'https://www.zoho.com/crm/features',
          excerpt: 'The product includes AI.',
          published: null,
        },
      ],
      [
        {
          name: 'Zoho CRM',
          aspects: [
            { label: 'official pricing', sourceIds: ['S1'] },
            { label: 'latest product release announcement', sourceIds: ['S2'] },
          ],
        },
      ],
      [],
      [],
      null,
      'gemini',
      new AbortController().signal,
    );
    expect(answer).not.toContain('$37');
    expect(answer).not.toContain('The product includes AI.');
    expect(answer).toContain('Pricing: Current evidence unavailable.');
    expect(answer).toContain('Product release: Current evidence unavailable.');
  });
  it('does not present a third-party pricing summary as vendor-verified pricing', async () => {
    const model = vi.fn(async () => [
      {
        text: JSON.stringify({
          items: [
            {
              name: 'Alpha',
              aspects: [
                {
                  label: 'official pricing',
                  finding: 'Starter costs $20 per seat monthly.',
                  sourceIds: ['S1'],
                  changedSinceReference: false,
                },
              ],
            },
          ],
        }),
      },
    ]) as unknown as typeof generate;
    const answer = await comparisonAnswer(
      model,
      'key',
      'model',
      'What changed?',
      [{ ...sources[0]!, url: 'https://reviews.example/alpha-pricing' }],
      [{ name: 'Alpha', aspects: [{ label: 'official pricing', sourceIds: ['S1'] }] }],
      [],
      [],
      null,
      'gemini',
      new AbortController().signal,
    );
    expect(answer).toContain('Current evidence unavailable');
    expect(answer).not.toContain('$20');
  });
});
