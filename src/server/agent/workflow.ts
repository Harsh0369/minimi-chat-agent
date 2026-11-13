import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import type { EmitEvent } from '../../shared/stream.js';
import { generate, type ModelContent } from './model.js';
import { webSearch, type SearchResult } from './search.js';
import { rankSearchResults, selectSearchResults } from './contextBudget.js';
import type { Config } from '../config.js';
import { missingComparisonCoverage, type ComparisonCoverage } from './coverage.js';

const searchArgs = z.object({ query: z.string().trim().min(2).max(250) });
const MAX_SEARCHES = 12;
const MAX_SEARCH_CONCURRENCY = 5;
type Parts = Awaited<ReturnType<typeof generate>>;
type ToolCall = NonNullable<Parts[number]['functionCall']>;

const AgentState = Annotation.Root({
  contents: Annotation<ModelContent[]>(),
  parts: Annotation<Parts>(),
  calls: Annotation<ToolCall[]>(),
  queries: Annotation<string[]>(),
  sources: Annotation<SearchResult[]>(),
  searches: Annotation<number>(),
  step: Annotation<number>(),
  text: Annotation<string>(),
  repaired: Annotation<boolean>(),
  coverageIssues: Annotation<string[]>(),
});

export async function runAnswerWorkflow(
  key: string,
  model: string,
  system: string,
  contents: ModelContent[],
  prefetchedSources: SearchResult[],
  searches: number,
  searchKey: string,
  signal: AbortSignal,
  emit?: EmitEvent,
  modelGenerate: typeof generate = generate,
  provider: Config['modelProvider'] = 'gemini',
  comparisonCoverage: ComparisonCoverage = [],
  webAllowed = true,
) {
  const graph = new StateGraph(AgentState)
    .addNode('reason', async (state) => {
      signal.throwIfAborted();
      await emit?.({ type: 'reset' });
      await emit?.({ type: 'status', message: 'Thinking…' });
      const canSearch =
        webAllowed && state.step < (provider === 'groq' ? 2 : 3) && state.searches < MAX_SEARCHES;
      const parts = await modelGenerate(
        key,
        model,
        canSearch
          ? system
          : `${system} The search phase is complete. Produce the final answer now from the supplied evidence. Do not request another search or emit a tool call.`,
        state.contents,
        signal,
        emit ? async (text) => emit({ type: 'delta', text }) : undefined,
        canSearch ? undefined : { tools: false },
      );
      if (parts.some((part) => part.functionCall && part.functionCall.name !== 'web_search'))
        throw new Error('UNKNOWN_TOOL');
      const calls = parts.flatMap((part) =>
        part.functionCall?.name === 'web_search' ? [part.functionCall] : [],
      );
      if (!canSearch && calls.length) throw new Error('SEARCH_NOT_ALLOWED_FOR_LOCAL_ANSWER');
      if (calls.length && (state.step >= 3 || state.searches + calls.length > MAX_SEARCHES))
        throw new Error('SEARCH_BUDGET_EXCEEDED');
      return {
        parts,
        calls,
        queries: calls.map((call) => searchArgs.parse(call.args).query),
        step: state.step + 1,
        text: calls.length
          ? ''
          : parts
              .map((part) => (part.thought ? '' : (part.text ?? '')))
              .join('')
              .trim(),
      };
    })
    .addNode('search', async (state) => {
      await emit?.({ type: 'reset' });
      await emit?.({ type: 'status', message: 'Searching the web…' });
      const batches = await searchQueries(state.queries, searchKey, signal);
      const sources = [...state.sources];
      const responses = state.calls.map((call, index) => {
        const ranked = rankSearchResults(batches[index]!.results, state.queries[index]!);
        const numbered = selectSearchResults(ranked, provider, false, state.queries[index]!).map(
          (result) => {
            const next = { ...result, id: `S${sources.length + 1}` };
            sources.push(next);
            return next;
          },
        );
        return {
          functionResponse: {
            ...(call.id ? { id: call.id } : {}),
            name: 'web_search',
            response: {
              query: state.queries[index],
              results: numbered,
              unavailable: batches[index]!.unavailable,
            },
          },
        };
      });
      return {
        contents: [
          ...state.contents,
          { role: 'model' as const, parts: state.parts },
          { role: 'user' as const, parts: responses },
        ],
        sources,
        searches: state.searches + state.calls.length,
      };
    })
    .addNode('verify', (state) => {
      if (!state.text) throw new Error('EMPTY_MODEL_RESPONSE');
      return { coverageIssues: missingComparisonCoverage(state.text, comparisonCoverage) };
    })
    .addNode('repair', async (state) => {
      signal.throwIfAborted();
      await emit?.({ type: 'reset' });
      await emit?.({ type: 'status', message: 'Checking sources…' });
      const evidence = state.sources.map(({ id, title, url, excerpt }) => ({
        id,
        title,
        url,
        excerpt,
      }));
      const parts = await modelGenerate(
        key,
        model,
        [
          system,
          'Revise the draft using only the listed web evidence for external claims. Cite supporting source IDs inline. Address every coverage gap listed in the request. If an item or aspect lacks evidence, explicitly mark it unverified. Do not invent citations or claim that an observation proves a historical change.',
        ].join(' '),
        [
          ...state.contents,
          { role: 'model', parts: [{ text: state.text }] },
          {
            role: 'user',
            parts: [
              {
                text: JSON.stringify({
                  task: 'Check and revise the draft',
                  coverageIssues: state.coverageIssues,
                  evidence,
                }),
              },
            ],
          },
        ],
        signal,
        emit ? async (text) => emit({ type: 'delta', text }) : undefined,
        { tools: false },
      );
      const text = parts
        .map((part) => (part.thought ? '' : (part.text ?? '')))
        .join('')
        .trim();
      if (!text) throw new Error('EMPTY_MODEL_RESPONSE');
      const known = new Set(state.sources.map((source) => source.id));
      const cited = [...text.matchAll(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g)].some((match) =>
        match[1]!.split(',').some((id) => known.has(id.trim())),
      );
      return {
        text:
          cited || !state.sources.length
            ? text
            : "I found search results, but couldn't verify the answer from them. Please try again.",
        repaired: true,
      };
    })
    .addEdge(START, 'reason')
    .addConditionalEdges('reason', (state) => (state.calls.length ? 'search' : 'verify'))
    .addEdge('search', 'reason')
    .addConditionalEdges('verify', (state) => {
      if (state.repaired) return END;
      if (state.coverageIssues.length) return 'repair';
      if (!state.sources.length) return END;
      const known = new Set(state.sources.map((source) => source.id));
      return [...state.text.matchAll(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g)].some((match) =>
        match[1]!.split(',').some((id) => known.has(id.trim())),
      )
        ? END
        : 'repair';
    })
    .addEdge('repair', END)
    .compile();
  const result = await graph.invoke(
    {
      contents,
      parts: [],
      calls: [],
      queries: [],
      sources: prefetchedSources,
      searches,
      step: 0,
      text: '',
      repaired: false,
      coverageIssues: [],
    },
    { signal, recursionLimit: 15 },
  );
  return { text: result.text, sources: result.sources };
}

async function searchQueries(queries: string[], key: string, signal: AbortSignal) {
  const batches: Array<{ results: SearchResult[]; unavailable: boolean }> = new Array(
    queries.length,
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(MAX_SEARCH_CONCURRENCY, queries.length) }, async () => {
      while (next < queries.length) {
        signal.throwIfAborted();
        const index = next++;
        try {
          batches[index] = {
            results: await webSearch(key, queries[index]!, signal),
            unavailable: false,
          };
        } catch (error) {
          if (signal.aborted) throw error;
          batches[index] = { results: [], unavailable: true };
        }
      }
    }),
  );
  return batches;
}
