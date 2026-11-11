import { z } from 'zod';
import type { MissingSetting } from '../shared/contracts.js';

const optionalSetting = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'),
  PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535))
    .prefault('3000'),
  DATABASE_PATH: z.string().trim().min(1).default('./data/minimi.sqlite'),
  OPENAI_API_KEY: optionalSetting,
  TAVILY_API_KEY: optionalSetting,
  CHAT_MODEL: optionalSetting,
  EMBEDDING_MODEL: z.string().trim().min(1).default('text-embedding-3-small'),
});

export class ConfigurationError extends Error {
  constructor(readonly fields: string[]) {
    // Field names only: Zod details or raw values could contain secrets.
    super(`Invalid configuration: ${fields.join(', ')}. Check .env.example.`);
    this.name = 'ConfigurationError';
  }
}

export function readConfig(env: Record<string, string | undefined>) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigurationError([
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  }
  const value = result.data;
  return Object.freeze({
    mode: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    databasePath: value.DATABASE_PATH,
    openaiApiKey: value.OPENAI_API_KEY,
    tavilyApiKey: value.TAVILY_API_KEY,
    chatModel: value.CHAT_MODEL,
    embeddingModel: value.EMBEDDING_MODEL,
  });
}
export type Config = ReturnType<typeof readConfig>;

export function missingProviderSettings(config: Config): MissingSetting[] {
  const missing: MissingSetting[] = [];
  if (!config.openaiApiKey) missing.push('OPENAI_API_KEY');
  if (!config.tavilyApiKey) missing.push('TAVILY_API_KEY');
  if (!config.chatModel) missing.push('CHAT_MODEL');
  return missing;
}
