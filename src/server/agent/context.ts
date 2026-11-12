import { z } from 'zod';
import { generate } from './model.js';

export type ConversationTurn = { role: string; text: string };
const routeSchema = z.object({
  scope: z.enum(['THREAD', 'WORKSPACE']),
  needsClock: z.boolean(),
  clockZones: z.array(z.string().min(1).max(64)).max(8),
  webPolicy: z.enum(['ALLOW', 'FORBID']).default('ALLOW'),
  answerBasis: z.enum(['CLOCK', 'MEMORY', 'EXTERNAL', 'GENERAL']).default('GENERAL'),
});
export type ContextRoute = z.infer<typeof routeSchema>;
const threadOnly: ContextRoute = {
  scope: 'THREAD',
  needsClock: false,
  clockZones: [],
  webPolicy: 'ALLOW',
  answerBasis: 'GENERAL',
};

// This routing model sees only the active thread. It has no tools or access to
// other conversations, so retrieval is decided before cross-chat data is read.
export async function routeContext(
  key: string,
  model: string,
  question: string,
  thread: ConversationTurn[],
  browserTimezone: string,
  signal: AbortSignal,
  modelGenerate: typeof generate = generate,
): Promise<ContextRoute> {
  const recent = thread.slice(-8).map(({ role, text }) => ({ role, text: text.slice(0, 600) }));
  const parts = await modelGenerate(
    key,
    model,
    [
      'Choose the context and clock facts needed to answer the latest user message.',
      'Return only a JSON object with scope, needsClock, clockZones, webPolicy, answerBasis. Do not answer the user.',
      'scope is THREAD or WORKSPACE. THREAD means the active conversation and ordinary knowledge or web search suffice, including short follow-ups. WORKSPACE means the user refers to an earlier interaction, answer, decision or list that is not present in recentThread. An explicit reference to another conversation or chat is always WORKSPACE. A past event mentioned in latestQuestion does not supply its missing details. Do not retrieve another chat merely because it is topically related. If unsure, use THREAD.',
      'needsClock is true if the latest message asks for current date or time, including an elliptical follow-up that changes the place after a date/time exchange in recentThread. Then clockZones contains representative valid IANA time zone IDs for the named place. For a region spanning time zones, include zones that can have different local dates. Use an empty list if no place is named or the browser timezone suffices. Otherwise needsClock is false and clockZones is empty.',
      'webPolicy is FORBID only when the answer can be derived entirely from the current conversation, retrieved workspace messages, or computed clock facts. A plain request to recall what the user said is FORBID. A pure date/time question is FORBID. Use ALLOW for current external facts, comparisons requiring research, or checking whether an earlier factual answer remains correct today. Never use search merely to locate the user’s own past messages.',
      'answerBasis is CLOCK when computed date/time facts alone answer the latest question, MEMORY when conversation records alone answer it, EXTERNAL when current outside facts are required, and GENERAL for ordinary chat. A short follow-up inherits its subject from recentThread. Choose EXTERNAL for a mixed clock or memory question only if answering also requires outside facts.',
    ].join(' '),
    [
      {
        role: 'user',
        parts: [
          {
            text: JSON.stringify({
              recentThread: recent,
              latestQuestion: question,
              browserTimezone,
            }),
          },
        ],
      },
    ],
    signal,
    undefined,
    { tools: false, maxOutputTokens: 240 },
  );
  try {
    const raw = parts
      .map((part) => part.text ?? '')
      .join('')
      .trim();
    const json = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const response = routeSchema.parse(JSON.parse(json));
    const clockZones = response.needsClock
      ? response.clockZones.filter((zone) => {
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: zone });
            return true;
          } catch {
            return false;
          }
        })
      : [];
    const webPolicy =
      response.answerBasis === 'CLOCK' ||
      response.answerBasis === 'MEMORY' ||
      (response.needsClock && response.answerBasis !== 'EXTERNAL')
        ? 'FORBID'
        : response.answerBasis === 'EXTERNAL'
          ? 'ALLOW'
          : response.webPolicy;
    return { ...response, clockZones, webPolicy };
  } catch {
    return threadOnly;
  }
}

export function clockFacts(now: number, browserTimezone: string, route: ContextRoute) {
  if (!route.needsClock) return null;
  const zones = [...new Set([browserTimezone, ...route.clockZones])];
  return {
    utc: new Date(now).toISOString(),
    local: zones.map((zone) => ({
      zone,
      dateTime: new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: zone,
      }).format(now),
    })),
  };
}
