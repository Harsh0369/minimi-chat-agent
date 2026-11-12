import { ChatOpenAI } from '@langchain/openai';
import { ChatGroq } from '@langchain/groq';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { Config } from '../config.js';
import { generate as generateGemini, type ModelContent } from './model.js';

type Generate = typeof generateGemini;
const search = tool(async () => 'The application executes web_search.', {
  name: 'web_search',
  description: 'Search the current public web for fresh or verifiable facts.',
  schema: z.object({ query: z.string().min(2).max(250) }),
});

export function createGenerate(config: Config): Generate {
  if (config.modelProvider === 'gemini') return generateGemini;
  const model =
    config.modelProvider === 'openai'
      ? new ChatOpenAI({
          apiKey: config.openaiApiKey ?? '',
          model: config.chatModel,
          maxRetries: 0,
          maxTokens: 2048,
        })
      : new ChatGroq({
          apiKey: config.groqApiKey ?? '',
          model: config.chatModel,
          maxRetries: 0,
          maxTokens: 1024,
        });
  const withTool = model.bindTools([search]);
  return async (_key, _model, system, contents, signal, onText, options) => {
    const messages = toMessages(system, contents);
    const runnable = options?.tools === false ? model : withTool;
    const reply = onText
      ? await (async () => {
          let combined: Awaited<ReturnType<typeof runnable.invoke>> | undefined;
          for await (const chunk of await runnable.stream(messages, { signal })) {
            combined = combined ? combined.concat(chunk) : chunk;
            if (chunk.text) await onText(chunk.text);
          }
          if (!combined) throw new Error('EMPTY_MODEL_STREAM');
          return combined;
        })()
      : await runnable.invoke(messages, { signal });
    if (reply.invalid_tool_calls?.length) throw new Error('INVALID_TOOL_CALL');
    const text = reply.text?.trim() ?? '';
    const calls = (reply.tool_calls ?? []).map((call) => ({
      functionCall: { name: call.name, args: call.args, ...(call.id ? { id: call.id } : {}) },
    }));
    if (!text && !calls.length) throw new Error('EMPTY_MODEL_RESPONSE');
    return [...(text ? [{ text }] : []), ...calls];
  };
}

function toMessages(system: string, contents: ModelContent[]): BaseMessage[] {
  const messages: BaseMessage[] = [new SystemMessage(system)];
  for (const content of contents) {
    const parts = content.parts as Array<{
      text?: string;
      functionCall?: { id?: string; name: string; args: unknown };
      functionResponse?: { id?: string; name: string; response: unknown };
    }>;
    if (content.role === 'model') {
      const calls = parts.flatMap((part, index) =>
        part.functionCall
          ? [
              {
                id: part.functionCall.id ?? `call-${messages.length}-${index}`,
                name: part.functionCall.name,
                args: part.functionCall.args as Record<string, unknown>,
              },
            ]
          : [],
      );
      messages.push(
        new AIMessage({
          content: parts.map((part) => part.text ?? '').join(''),
          ...(calls.length ? { tool_calls: calls } : {}),
        }),
      );
      continue;
    }
    const text = parts.map((part) => part.text ?? '').join('');
    if (text) messages.push(new HumanMessage(text));
    for (const part of parts) {
      if (!part.functionResponse) continue;
      if (!part.functionResponse.id) throw new Error('MISSING_TOOL_CALL_ID');
      messages.push(
        new ToolMessage({
          tool_call_id: part.functionResponse.id,
          name: part.functionResponse.name,
          content: JSON.stringify(part.functionResponse.response),
        }),
      );
    }
  }
  return messages;
}
