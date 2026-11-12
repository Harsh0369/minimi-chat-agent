import { z } from 'zod';
import { readBoundedJson } from './readJson.js';
import { fetchProvider } from './fetchProvider.js';
import { readLines } from '../../shared/stream.js';

const part = z
  .object({
    thought: z.boolean().optional(),
    text: z.string().optional(),
    functionCall: z
      .object({ id: z.string().optional(), name: z.string(), args: z.unknown() })
      .optional(),
  })
  .passthrough();
const responseSchema = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(part) }) })).min(1),
});
const chunkSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(part).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});
export type ModelContent = { role: 'user' | 'model'; parts: unknown[] };
export async function generate(
  key: string,
  model: string,
  system: string,
  contents: ModelContent[],
  signal: AbortSignal,
  onText?: (text: string) => Promise<void>,
) {
  const response = await fetchProvider(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${onText ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [
          {
            functionDeclarations: [
              {
                name: 'web_search',
                description:
                  'Search the current public web when a question needs fresh or verifiable external facts. Search only public information.',
                parameters: {
                  type: 'object',
                  properties: {
                    query: {
                      type: 'string',
                      description: 'A focused search query, maximum 250 characters',
                    },
                  },
                  required: ['query'],
                },
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
    },
  );
  if (!response.ok) throw new Error(`MODEL_${response.status}`);
  if (onText) {
    if (!response.body) throw new Error('EMPTY_MODEL_STREAM');
    const parts: z.infer<typeof part>[] = [];
    let data: string[] = [];
    let finished = false;
    const consume = async () => {
      if (!data.length) return;
      const chunk = chunkSchema.parse(JSON.parse(data.join('\n')));
      data = [];
      if (chunk.promptFeedback?.blockReason) throw new Error('MODEL_BLOCKED');
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) {
        if (candidate.finishReason !== 'STOP') throw new Error('MODEL_INCOMPLETE');
        finished = true;
      }
      for (const item of candidate?.content?.parts ?? []) {
        parts.push(item); // Keep thought signatures and full function-call payloads for tool replies.
        if (item.text && !item.thought) await onText(item.text);
      }
    };
    for await (const line of readLines(response.body)) {
      if (!line) await consume();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    await consume();
    if (!finished || !parts.length) throw new Error('INCOMPLETE_MODEL_STREAM');
    return parts;
  }
  return responseSchema.parse(await readBoundedJson(response, 1_000_000)).candidates[0]!.content
    .parts;
}
