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
  MODEL_PROVIDER: z.enum(['gemini', 'openai', 'groq']).default('gemini'),
  GEMINI_API_KEY: optionalSetting,
  OPENAI_API_KEY: optionalSetting,
  GROQ_API_KEY: optionalSetting,
  TAVILY_API_KEY: optionalSetting,
  CHAT_MODEL: optionalSetting,
  EMBEDDING_MODEL: z.enum(['gemini-embedding-001']).optional(),
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
    modelProvider: value.MODEL_PROVIDER,
    geminiApiKey: value.GEMINI_API_KEY,
    openaiApiKey: value.OPENAI_API_KEY,
    groqApiKey: value.GROQ_API_KEY,
    tavilyApiKey: value.TAVILY_API_KEY,
    chatModel:
      value.CHAT_MODEL ??
      (value.MODEL_PROVIDER === 'gemini'
        ? 'gemini-3.5-flash-lite'
        : value.MODEL_PROVIDER === 'groq'
          ? 'openai/gpt-oss-120b'
          : ''),
    embeddingModel: value.EMBEDDING_MODEL,
  });
}
export type Config = ReturnType<typeof readConfig>;

export function missingProviderSettings(config: Config): MissingSetting[] {
  const missing: MissingSetting[] = [];
  if (config.modelProvider === 'gemini' && !config.geminiApiKey) missing.push('GEMINI_API_KEY');
  if (config.modelProvider === 'openai' && !config.openaiApiKey) missing.push('OPENAI_API_KEY');
  if (config.modelProvider === 'groq' && !config.groqApiKey) missing.push('GROQ_API_KEY');
  if (!config.chatModel) missing.push('CHAT_MODEL');
  if (!config.tavilyApiKey) missing.push('TAVILY_API_KEY');
  return missing;
}
