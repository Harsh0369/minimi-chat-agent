import { z } from 'zod';
import { readBoundedJson } from './readJson.js';

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
export type ModelContent = { role: 'user' | 'model'; parts: unknown[] };
export async function generate(
  key: string,
  model: string,
  system: string,
  contents: ModelContent[],
  signal: AbortSignal,
) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
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
                  type: 'OBJECT',
                  properties: {
                    query: {
                      type: 'STRING',
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
  return responseSchema.parse(await readBoundedJson(response, 1_000_000)).candidates[0]!.content
    .parts;
}
