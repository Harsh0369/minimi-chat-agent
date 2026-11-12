const defaults: Record<string, string> = {
  'Asia/Kolkata': 'India (INR)',
  'Asia/Calcutta': 'India (INR)',
  'Asia/Singapore': 'Singapore (SGD)',
  'Asia/Tokyo': 'Japan (JPY)',
  'Europe/London': 'United Kingdom (GBP)',
  'Europe/Berlin': 'Germany (EUR)',
  'America/New_York': 'United States (USD)',
  'America/Chicago': 'United States (USD)',
  'America/Los_Angeles': 'United States (USD)',
  'America/Toronto': 'Canada (CAD)',
  'Australia/Sydney': 'Australia (AUD)',
};
const explicitMarket =
  /\b(?:USD|INR|GBP|EUR|JPY|CAD|AUD|SGD|United States|USA|US|India|UK|London|Singapore|Japan|Canada|Australia|Dubai|UAE)\b/i;
const namedPlace = /\b(?:in|at)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/u;

function hasExplicitMarket(question: string) {
  return explicitMarket.test(question) || namedPlace.test(question);
}

export function marketSearchPlan(question: string, timezone: string) {
  const hint = defaults[timezone];
  if (!hint || hasExplicitMarket(question) || !/\b(pric(?:e|es|ing)|rates?|cost)\b/i.test(question))
    return null;
  const country = hint.replace(/ \(.+\)$/, '');
  const currency = hint.match(/\(([^)]+)\)/)?.[1];
  const topic = question.replace(/\s+/g, ' ').trim().slice(0, 140);
  const detail = /\bgold\b/i.test(question) ? ' 24K per 10g retail versus spot' : '';
  return {
    market: hint,
    query: `${topic} ${country} ${currency ?? ''}${detail} current`.slice(0, 250),
  };
}

export function marketContext(question: string, timezone: string) {
  const hint = defaults[timezone];
  const explicit =
    'A location or currency explicitly stated in the latest question always overrides any browser hint.';
  if (hasExplicitMarket(question)) return explicit;
  if (hint)
    return `${explicit} The browser timezone suggests ${hint} as a weak market default. Only for an unspecified location-sensitive price, search that market first and label it as an assumption; offer to refine by city, currency, product grade or unit. Never silently substitute a US price. The user may be traveling, so do not present timezone as verified residence.`;
  return `${explicit} No reliable market can be inferred from the browser timezone. For an unspecified location-sensitive price, ask for country/currency or give a clearly labeled global reference with a clarification request. Never silently assume a US retail price.`;
}
