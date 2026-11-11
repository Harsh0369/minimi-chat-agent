import { z } from 'zod';

// Client-safe contracts only. Never import server configuration from this module.
export const missingSettingSchema = z.enum(['OPENAI_API_KEY', 'TAVILY_API_KEY', 'CHAT_MODEL']);
export type MissingSetting = z.infer<typeof missingSettingSchema>;

export const serviceStatusSchema = z.strictObject({
  stage: z.enum(['foundation', 'persistence']),
  capabilities: z.strictObject({
    chat: z.literal(false),
    memory: z.literal(false),
    webSearch: z.literal(false),
  }),
  configuration: z.strictObject({
    providersConfigured: z.boolean(),
    missing: z.array(missingSettingSchema),
  }),
});
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    requestId: z.uuid(),
  }),
});

// Persist receipt time on the server later; the browser cannot supply historical timestamps.
export const submitMessageSchema = z.strictObject({
  requestId: z.uuid(),
  text: z
    .string()
    .min(1)
    .max(16_000)
    .refine((value) => value.trim().length > 0, 'Enter a message.'),
  timezone: z
    .string()
    .max(100)
    .refine((value) => {
      if (!/^(?:UTC|[A-Za-z_+-]+\/[A-Za-z0-9_+/-]+)$/.test(value)) return false;
      try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format();
        return value.length > 0;
      } catch {
        return false;
      }
    }, 'Use a valid IANA timezone.'),
});

// This is the only external tool identifier the later agent module may expose.
export const EXTERNAL_TOOL_NAMES = ['web_search'] as const;
