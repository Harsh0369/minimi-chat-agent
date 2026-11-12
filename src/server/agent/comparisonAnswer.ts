import { z } from 'zod';
import type { Config } from '../config.js';
import type { generate } from './model.js';
import type { SearchResult } from './search.js';
import type { ComparisonCoverage } from './coverage.js';

const findingSchema = z.object({
  label: z.string(),
  finding: z.string().trim().max(360),
  sourceIds: z.array(z.string()).max(4),
  changedSinceReference: z.boolean(),
});
const resultSchema = z.object({
  items: z.array(z.object({ name: z.string(), aspects: z.array(findingSchema) })).max(6),
});
const geminiSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          aspects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                finding: { type: 'string' },
                sourceIds: { type: 'array', items: { type: 'string' } },
                changedSinceReference: { type: 'boolean' },
              },
              required: ['label', 'finding', 'sourceIds', 'changedSinceReference'],
            },
          },
        },
        required: ['name', 'aspects'],
      },
    },
  },
  required: ['items'],
};

type HistoricalSource = {
  title: string;
  url: string;
  excerpt: string;
  observedAt: string;
  published: string | null;
};

export function isLikelyVendorSource(vendor: string, source: SearchResult) {
  const brand = vendor
    .toLowerCase()
    .split(/\s+/)[0]!
    .replace(/[^a-z0-9]/g, '');
  const host = new URL(source.url).hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')[0]!
    .replace(/[^a-z0-9]/g, '');
  return (
    brand.length >= 3 && host.length >= 3 && (host === brand || host.startsWith(brand.slice(0, 5)))
  );
}

function dateAfter(value: string | null, reference: string | null) {
  if (!value || !reference) return false;
  const parsed = Date.parse(value);
  const day = Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
  return Boolean(day && day > reference);
}

const productLines = ['sales', 'marketing', 'service', 'commerce', 'support'];
function relevantProductLine(question: string, vendor: string, source: SearchResult) {
  const requested = productLines.filter((line) => new RegExp(`\\b${line}\\b`, 'i').test(question));
  const label = `${source.title} ${new URL(source.url).pathname}`;
  const named = productLines.filter((line) => new RegExp(`\\b${line}\\b`, 'i').test(label));
  if (requested.length && named.length && !named.some((line) => requested.includes(line)))
    return false;
  const vendorProduct = vendor.toLowerCase().split(/\s+/).slice(1);
  if (
    vendorProduct.length &&
    !vendorProduct.every((word) => new RegExp(`\\b${word}\\b`, 'i').test(label))
  )
    return false;
  return true;
}

export function sourceFitScore(vendor: string, aspect: string, source: SearchResult) {
  const official = isLikelyVendorSource(vendor, source);
  const path = new URL(source.url).pathname.toLowerCase();
  const title = source.title.toLowerCase();
  const price = /pricing/i.test(aspect);
  return (
    Number(official) * 10 +
    Number(price ? /pricing|plans/.test(path) : /release|updates|news/.test(path)) * 5 +
    Number(price ? /pricing|plans/.test(title) : /release|updates|news|what.s new/.test(title)) * 2
  );
}

function supportsRelease(source: SearchResult) {
  const excerpt = `${source.title} ${source.excerpt}`;
  return (
    /\b(released?|launch(?:ed)?|announced?|introduced?|shipped|updated?|refreshed)\b/i.test(
      excerpt,
    ) && !/\b(pricing|plans?|subscription)\b/i.test(source.title)
  );
}

function moneyMentions(value: string) {
  return [...value.matchAll(/(?:[$₹€£]\s*\d[\d,.]*|\b\d[\d,.]*\s*(?:USD|INR|EUR|GBP)\b)/gi)].map(
    (match) => match[0]!.replace(/\s+/g, '').toLowerCase(),
  );
}

export function supportedAmounts(finding: string, sources: SearchResult[]) {
  const amounts = moneyMentions(finding);
  if (!amounts.length) return true;
  const observed = new Set(sources.flatMap((source) => moneyMentions(source.excerpt)));
  return amounts.every((amount) => observed.has(amount));
}

function comparablePriceChange(
  vendor: string,
  historical: HistoricalSource[],
  current: SearchResult[],
  referenceDate: string | null,
) {
  if (!referenceDate) return false;
  const brand = vendor.toLowerCase().split(/\s+/)[0]!;
  const old = historical.filter(
    (source) =>
      source.observedAt.slice(0, 10) <= referenceDate &&
      `${source.title} ${source.url}`.toLowerCase().includes(brand),
  );
  const tiers = [
    'starter',
    'basic',
    'standard',
    'professional',
    'pro',
    'premium',
    'team',
    'business',
    'enterprise',
  ];
  const units = ['per user', 'per seat', '/user', '/seat', 'monthly', 'yearly', 'annually'];
  for (const before of old)
    for (const after of current) {
      const oldText = before.excerpt.toLowerCase();
      const newText = after.excerpt.toLowerCase();
      const sameTier = tiers.some(
        (tier) =>
          new RegExp(`\\b${tier}\\b`).test(oldText) && new RegExp(`\\b${tier}\\b`).test(newText),
      );
      const sameUnit = units.some((unit) => oldText.includes(unit) && newText.includes(unit));
      if (!sameTier || !sameUnit) continue;
      const oldPrices = moneyMentions(oldText);
      const newPrices = moneyMentions(newText);
      if (
        oldPrices.length === 1 &&
        newPrices.length === 1 &&
        oldPrices[0] !== newPrices[0] &&
        oldPrices[0]![0] === newPrices[0]![0]
      )
        return true;
    }
  return false;
}

export async function comparisonAnswer(
  modelGenerate: typeof generate,
  key: string,
  model: string,
  question: string,
  sources: SearchResult[],
  coverage: ComparisonCoverage,
  historical: HistoricalSource[],
  previousAnswers: Array<{ at: string; text: string }>,
  referenceDate: string | null,
  provider: Config['modelProvider'],
  signal: AbortSignal,
) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const fallback = `I couldn't verify what changed${referenceDate ? ` since ${referenceDate}` : ''} for every item in your shortlist. Please try again or ask about one tool at a time.`;
  try {
    const parts = await modelGenerate(
      key,
      model,
      [
        'You are an evidence examiner. Return only JSON in this exact shape: {"items":[{"name":"vendor name","aspects":[{"label":"requested label","finding":"short supported finding","sourceIds":["S1"],"changedSinceReference":false}]}]}. Include every requested vendor and every requested aspect exactly once. Do not return an answer field or prose outside JSON.',
        'For each aspect, give a concise CURRENT finding supported directly by the listed source excerpt, with sourceIds from that aspect only. If no source supports a factual finding, use an empty sourceIds array and say evidence is unavailable. Prefer official vendor pages. Do not use marketing or pricing from a different product line.',
        'changedSinceReference is true only with comparable old and current prices for the same tier, currency, unit and billing terms, or an explicit dated release AFTER the reference date. Current observations, undated pages, and releases before the reference date are not proof of change. Use false when uncertain. Do not repeat prompt instructions in the findings.',
      ].join(' '),
      [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                question,
                referenceDate,
                requested: coverage,
                previousAnswers: previousAnswers.slice(0, 8),
                historicalSourceSnapshots: historical.slice(0, 20),
                currentSources: sources
                  .slice(0, provider === 'groq' ? 22 : 36)
                  .map(({ id, title, url, excerpt, published, observedAt }) => ({
                    id,
                    title,
                    url,
                    published,
                    observedAt,
                    excerpt: excerpt.slice(0, provider === 'groq' ? 180 : 380),
                  })),
              }),
            },
          ],
        },
      ],
      signal,
      undefined,
      {
        tools: false,
        maxOutputTokens: provider === 'groq' ? 950 : 3000,
        ...(provider === 'gemini' ? { jsonSchema: geminiSchema } : {}),
      },
    );
    let raw = parts
      .map((part) => part.text ?? '')
      .join('')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    let parsed: z.infer<typeof resultSchema> | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const value = JSON.parse(raw) as unknown;
      if (typeof value === 'string') raw = value;
      else {
        parsed = resultSchema.parse(value);
        break;
      }
    }
    if (!parsed || parsed.items.length !== coverage.length) throw new Error('ITEM_COUNT');
    const lines: string[] = [];
    let verifiedChanges = 0;
    for (const item of coverage) {
      const response = parsed.items.find(
        (candidate) => candidate.name.toLowerCase() === item.name.toLowerCase(),
      );
      if (!response || response.aspects.length !== item.aspects.length)
        throw new Error('ASPECT_COUNT');
      lines.push(`**${item.name}**`);
      for (const aspect of item.aspects) {
        const finding = response.aspects.find((candidate) => candidate.label === aspect.label);
        if (!finding) throw new Error('ASPECT_MISSING');
        let validIds = [...new Set(finding.sourceIds)].filter(
          (id) =>
            aspect.sourceIds.includes(id) &&
            byId.has(id) &&
            isLikelyVendorSource(item.name, byId.get(id)!) &&
            relevantProductLine(question, item.name, byId.get(id)!),
        );
        const price = /pricing/i.test(aspect.label);
        if (price)
          validIds = validIds.filter((id) => {
            const source = byId.get(id)!;
            return /pricing|plans/i.test(`${new URL(source.url).pathname} ${source.title}`);
          });
        if (!price) validIds = validIds.filter((id) => supportsRelease(byId.get(id)!));
        if (
          !supportedAmounts(
            finding.finding,
            validIds.map((id) => byId.get(id)!),
          )
        )
          validIds = [];
        const datedRelease = validIds.some((id) =>
          dateAfter(byId.get(id)!.published, referenceDate),
        );
        const verified =
          finding.changedSinceReference &&
          (price
            ? comparablePriceChange(
                item.name,
                historical,
                validIds.map((id) => byId.get(id)!),
                referenceDate,
              )
            : datedRelease);
        if (verified) verifiedChanges++;
        const statement = validIds.length ? finding.finding : 'Current evidence unavailable.';
        const heading = price ? 'Pricing' : 'Product release';
        lines.push(
          `- ${heading}: ${statement}${validIds.map((id) => ` [${id}]`).join('')}${verified ? ' (verified after the earlier discussion)' : ''}`,
        );
      }
      lines.push('');
    }
    const opening = verifiedChanges
      ? `I could verify ${verifiedChanges} change${verifiedChanges === 1 ? '' : 's'}${referenceDate ? ` since ${referenceDate}` : ''}; other changes remain unverified.`
      : `I couldn't verify a pricing change or a newly released feature${referenceDate ? ` since ${referenceDate}` : ''} from the available evidence. Here are the current findings:`;
    return [opening, '', ...lines].join('\n').trim();
  } catch (error) {
    if (signal.aborted) throw error;
    return fallback;
  }
}
