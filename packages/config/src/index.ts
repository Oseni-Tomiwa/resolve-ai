import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

export type AIProvider = 'openai' | 'anthropic' | 'google';
export type AIModelDefinition = {
  provider: AIProvider;
  id: string;
  label: string;
  enabled: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsToolCalling: boolean;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
};

export const generationModels: readonly AIModelDefinition[] = [
  { provider: 'openai', id: 'gpt-4o-mini', label: 'GPT-4o mini', enabled: true, supportsStreaming: true, supportsStructuredOutput: true, supportsToolCalling: true },
  { provider: 'anthropic', id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', enabled: true, supportsStreaming: true, supportsStructuredOutput: false, supportsToolCalling: true },
  { provider: 'google', id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', enabled: true, supportsStreaming: true, supportsStructuredOutput: true, supportsToolCalling: true },
];
export const embeddingModels = [{ id: 'text-embedding-3-small', label: 'text-embedding-3-small' }] as const;
export const generationModelIds = generationModels.map((model) => model.id) as [string, ...string[]];
export const embeddingModelIds = embeddingModels.map((model) => model.id) as [string, ...string[]];
export const getGenerationModel = (provider: string, model: string): AIModelDefinition | undefined => generationModels.find((candidate) => candidate.provider === provider && candidate.id === model && candidate.enabled);
export const isGenerationModelEnabled = (model: string): boolean => generationModels.some((candidate) => candidate.id === model && candidate.enabled);
const optionalOpenAIKey = z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).default('ResolveAI'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  WORKER_PORT: z.coerce.number().int().nonnegative().default(4100),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(20).default(2),
  WORKER_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000/api/v1'),
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:4000/api/v1'),
  WIDGET_SCRIPT_URL: z.string().url().default('http://localhost:3000/widget.js'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z.preprocess((value) => value === undefined ? undefined : value === true || value === 'true', z.boolean().default(false)),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  KNOWLEDGE_STORAGE_DIR: z.string().default('storage'),
  KNOWLEDGE_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().max(100 * 1024 * 1024).default(10 * 1024 * 1024),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  BILLING_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_BUSINESS: z.string().optional(),
  STRIPE_SUCCESS_URL: z.string().url().optional(),
  STRIPE_CANCEL_URL: z.string().url().optional(),
  STRIPE_PORTAL_RETURN_URL: z.string().url().optional(),
  STRIPE_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  EMAIL_PROVIDER: z.enum(['console', 'smtp', 'resend', 'test']).default('console'),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_API_URL: z.string().url().default('https://api.resend.com/emails'),
  EMAIL_REPLY_TO: z.string().email().optional(),
  EMAIL_FROM_NAME: z.string().default('ResolveAI'),
  EMAIL_FROM_ADDRESS: z.string().email().default('no-reply@example.com'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  WEBHOOK_ENCRYPTION_KEY: z.string().min(32).optional(),
  WEBHOOK_DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().max(120000).default(10000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(5),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SENTRY_DSN: z.string().url().optional(),
  RELEASE: z.string().optional(),
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(0),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  PUBLIC_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  PUBLIC_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  API_BODY_LIMIT: z.string().default('2mb'),
});
export const embeddingEnvSchema = z.object({
  OPENAI_API_KEY: optionalOpenAIKey,
  OPENAI_EMBEDDING_MODEL: z.enum(embeddingModelIds).default('text-embedding-3-small'),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(50),
});
export type EmbeddingEnv = z.infer<typeof embeddingEnvSchema>;
export const loadEmbeddingEnv = (input: Record<string, string | undefined>): EmbeddingEnv => embeddingEnvSchema.parse(input);
export const generationEnvSchema = z.object({
  OPENAI_API_KEY: optionalOpenAIKey,
  ANTHROPIC_API_KEY: optionalOpenAIKey,
  GOOGLE_AI_API_KEY: optionalOpenAIKey,
  OPENAI_GENERATION_MODEL: z.string().min(1).default('gpt-4o-mini'),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(2000).default(800),
  AI_RETRIEVAL_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
  AI_MINIMUM_SCORE: z.coerce.number().min(0).max(1).default(0.4),
}).superRefine((value, context) => {
  if (!getGenerationModel('openai', value.OPENAI_GENERATION_MODEL)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['OPENAI_GENERATION_MODEL'], message: 'OPENAI_GENERATION_MODEL is not an enabled OpenAI model' });
});
export type GenerationEnv = z.infer<typeof generationEnvSchema>;
export const loadGenerationEnv = (input: Record<string, string | undefined>): GenerationEnv => generationEnvSchema.parse(input);
export type AIEnvironment = EmbeddingEnv & GenerationEnv & { EMBEDDING_BATCH_SIZE: number };
export const loadAIEnv = (input: Record<string, string | undefined>): AIEnvironment => ({ ...loadEmbeddingEnv(input), ...loadGenerationEnv(input) });
export type Env = z.infer<typeof envSchema>;
export const loadEnv = (input: Record<string, string | undefined>): Env => envSchema.parse(input);

export type RuntimeEnv = Env & GenerationEnv & EmbeddingEnv;

export type RedisConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  maxRetriesPerRequest?: number | null;
  enableOfflineQueue?: boolean;
};

export function redisConnectionOptions(value: string, mode: 'producer' | 'worker' = 'producer'): RedisConnectionOptions {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL'); }
  if (!['redis:', 'rediss:'].includes(parsed.protocol) || parsed.hostname.length === 0) throw new Error('REDIS_URL must use redis:// or rediss://');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: mode === 'worker' ? null : 1,
    enableOfflineQueue: false,
  };
}

export function redisConnectionOptionsFromEnv(input: { REDIS_URL?: string; NODE_ENV?: string } = process.env, mode: 'producer' | 'worker' = 'producer'): RedisConnectionOptions {
  const value = input.REDIS_URL ?? (input.NODE_ENV === 'production' ? undefined : 'redis://localhost:6379');
  if (!value) throw new Error('REDIS_URL is required');
  return redisConnectionOptions(value, mode);
}

const isLocalUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
};

export const validateRuntimeEnv = (input: Record<string, string | undefined>): RuntimeEnv => {
  const env = loadEnv(input);
  const ai = loadAIEnv(input);
  if (env.NODE_ENV !== 'production') return { ...env, ...ai };
  const errors: string[] = [];
  if (env.JWT_ACCESS_SECRET.includes('replace-with') || env.JWT_REFRESH_SECRET.includes('replace-with')) errors.push('JWT secrets must be replaced with strong production values');
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) errors.push('JWT access and refresh secrets must differ');
  if (!ai.OPENAI_API_KEY) errors.push('OPENAI_API_KEY is required in production');
  if (!getGenerationModel('openai', ai.OPENAI_GENERATION_MODEL)) errors.push(`OPENAI_GENERATION_MODEL is not an enabled OpenAI model: ${ai.OPENAI_GENERATION_MODEL}`);
  for (const [name, value] of [['WEB_URL', env.WEB_URL], ['API_URL', env.API_URL], ['PUBLIC_API_URL', env.PUBLIC_API_URL], ['NEXT_PUBLIC_API_URL', env.NEXT_PUBLIC_API_URL], ['WIDGET_SCRIPT_URL', env.WIDGET_SCRIPT_URL]] as const) {
    if (isLocalUrl(value)) errors.push(`${name} must not use localhost in production`);
    if (!value.startsWith('https://')) errors.push(`${name} must use HTTPS in production`);
  }
  if (!env.COOKIE_SECURE) errors.push('COOKIE_SECURE must be true in production');
  if (env.TRUST_PROXY !== 1) errors.push('TRUST_PROXY must be 1 behind the single AWS ALB hop');
  if (env.COOKIE_SAME_SITE === 'none' && !env.COOKIE_SECURE) errors.push('COOKIE_SAME_SITE=none requires secure cookies');
  for (const origin of env.CORS_ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) errors.push('CORS_ALLOWED_ORIGINS must contain exact HTTPS origins');
    } catch { errors.push('CORS_ALLOWED_ORIGINS contains an invalid origin'); }
  }
  if (env.STORAGE_PROVIDER === 's3' && (!env.S3_BUCKET || !env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)) errors.push('S3 storage requires bucket, region, access key, and secret key configuration');
  if (env.STORAGE_PROVIDER !== 's3') errors.push('STORAGE_PROVIDER must be s3 in production; local filesystem storage is not supported');
  if (env.BILLING_PROVIDER !== 'stripe') errors.push('BILLING_PROVIDER must be stripe in production; mock billing is not supported');
  if (env.BILLING_PROVIDER === 'stripe') {
    if (!env.STRIPE_SECRET_KEY) errors.push('Stripe billing requires STRIPE_SECRET_KEY');
    if (!env.STRIPE_WEBHOOK_SECRET) errors.push('Stripe billing requires STRIPE_WEBHOOK_SECRET');
    if (!env.STRIPE_PRICE_PRO || !env.STRIPE_PRICE_BUSINESS) errors.push('Stripe billing requires STRIPE_PRICE_PRO and STRIPE_PRICE_BUSINESS');
  }
  if (env.EMAIL_PROVIDER === 'smtp' && (!env.SMTP_HOST || !env.SMTP_PORT)) errors.push('SMTP email requires SMTP_HOST and SMTP_PORT');
  if (env.NODE_ENV === 'production' && (env.EMAIL_PROVIDER === 'console' || env.EMAIL_PROVIDER === 'test')) errors.push('Console and test email providers are not allowed in production');
  if (env.EMAIL_PROVIDER === 'resend' && !env.EMAIL_API_KEY) errors.push('Resend email requires EMAIL_API_KEY');
  if (env.NODE_ENV === 'production' && !env.WEBHOOK_ENCRYPTION_KEY) errors.push('WEBHOOK_ENCRYPTION_KEY is required in production');
  if (errors.length > 0) throw new Error(`Production environment validation failed: ${errors.join('; ')}`);
  return { ...env, ...ai };
};

export function loadRootEnv(): string {
  const envFilePath = resolve(__dirname, '../../../.env');
  loadDotenv({ path: envFilePath, override: false });
  if (process.env.NODE_ENV !== 'production') {
    console.info(JSON.stringify({ event: 'environment.loaded', cwd: process.cwd(), envFilePath, databaseUrlConfigured: Boolean(process.env.DATABASE_URL), nodeEnv: process.env.NODE_ENV ?? 'undefined' }));
  }
  return envFilePath;
}
