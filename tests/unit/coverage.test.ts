import { describe, expect, it } from 'vitest';
import { missingComparisonCoverage } from '../../src/server/agent/coverage.js';

describe('comparison coverage', () => {
  const coverage = [
    {
      name: 'Alpha CRM',
      aspects: [
        { label: 'official pricing', sourceIds: ['S1'] },
        { label: 'latest product release announcement', sourceIds: ['S2'] },
      ],
    },
    {
      name: 'Beta CRM',
      aspects: [{ label: 'official pricing', sourceIds: [] }],
    },
  ];

  it('identifies omitted items, missing aspect citations and unavailable evidence', () => {
    expect(missingComparisonCoverage('Alpha CRM pricing [S1].', coverage)).toEqual([
      'Alpha CRM: latest product release announcement lacks a linked source',
      'Beta CRM: item not addressed',
    ]);
    expect(
      missingComparisonCoverage(
        'Alpha CRM pricing [S1], release [S2]. Beta CRM unverified.',
        coverage,
      ),
    ).toEqual(['Beta CRM: official pricing has no retrieved evidence']);
  });
});
