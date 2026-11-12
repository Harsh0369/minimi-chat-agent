export type ComparisonCoverage = Array<{
  name: string;
  aspects: Array<{ label: string; sourceIds: string[] }>;
}>;

export function missingComparisonCoverage(answer: string, coverage: ComparisonCoverage) {
  const lower = answer.toLocaleLowerCase();
  const missing: string[] = [];
  for (const item of coverage) {
    if (!lower.includes(item.name.toLocaleLowerCase())) {
      missing.push(`${item.name}: item not addressed`);
      continue;
    }
    for (const aspect of item.aspects) {
      if (!aspect.sourceIds.length) {
        // A missing search result must remain visible even if the draft sounds confident.
        missing.push(`${item.name}: ${aspect.label} has no retrieved evidence`);
        continue;
      }
      if (!aspect.sourceIds.some((id) => answer.includes(`[${id}]`)))
        missing.push(`${item.name}: ${aspect.label} lacks a linked source`);
    }
  }
  return missing;
}
