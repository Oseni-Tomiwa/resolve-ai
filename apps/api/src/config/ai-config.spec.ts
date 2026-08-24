import { loadEmbeddingEnv, loadGenerationEnv, validateRuntimeEnv } from '@resolveai/config';

describe('AI environment contract', () => {
  it('allows a safe development configuration without an API key', () => {
    // Arrange / Act
    const generation = loadGenerationEnv({});
    const embedding = loadEmbeddingEnv({});
    // Assert
    expect(generation.OPENAI_API_KEY).toBeUndefined();
    expect(generation.OPENAI_GENERATION_MODEL).toBe('gpt-4o-mini');
    expect(embedding.OPENAI_EMBEDDING_MODEL).toBe('text-embedding-3-small');
  });

  it('accepts a valid key and canonical model settings without exposing the key', () => {
    // Arrange / Act
    const generation = loadGenerationEnv({ OPENAI_API_KEY: 'sk-test-only', OPENAI_GENERATION_MODEL: 'gpt-4o-mini', AI_MAX_OUTPUT_TOKENS: '600', AI_RETRIEVAL_LIMIT: '5', AI_MINIMUM_SCORE: '0.65' });
    // Assert
    expect(generation).toMatchObject({ OPENAI_GENERATION_MODEL: 'gpt-4o-mini', AI_MAX_OUTPUT_TOKENS: 600 });
    expect(JSON.stringify({ model: generation.OPENAI_GENERATION_MODEL })).not.toContain('sk-test-only');
  });

  it('accepts optional Anthropic and Google provider credentials without exposing them', () => {
    const generation = loadGenerationEnv({ ANTHROPIC_API_KEY: 'anthropic-test-only', GOOGLE_AI_API_KEY: 'google-test-only', OPENAI_GENERATION_MODEL: 'gpt-4o-mini' });
    expect(generation).toMatchObject({ ANTHROPIC_API_KEY: 'anthropic-test-only', GOOGLE_AI_API_KEY: 'google-test-only' });
    expect(JSON.stringify({ model: generation.OPENAI_GENERATION_MODEL })).not.toContain('test-only');
  });

  it('rejects unsupported models and invalid numeric settings', () => {
    // Arrange / Act / Assert
    expect(() => loadGenerationEnv({ OPENAI_GENERATION_MODEL: 'unknown-model' })).toThrow();
    expect(() => loadEmbeddingEnv({ OPENAI_EMBEDDING_MODEL: 'unknown-embedding' })).toThrow();
    expect(() => loadGenerationEnv({ AI_MAX_OUTPUT_TOKENS: '20' })).toThrow();
    expect(() => loadGenerationEnv({ AI_RETRIEVAL_LIMIT: '0' })).toThrow();
    expect(() => loadGenerationEnv({ AI_MINIMUM_SCORE: '1.2' })).toThrow();
    expect(() => loadEmbeddingEnv({ EMBEDDING_BATCH_SIZE: '0' })).toThrow();
  });

  it('accepts development defaults without an OpenAI key', () => {
    const env = validateRuntimeEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost/db', REDIS_URL: 'redis://localhost:6379', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.API_PORT).toBe(4000);
    expect(env.BILLING_PROVIDER).toBe('mock');
  });

  it('rejects unsafe production configuration without exposing secret values', () => {
    expect(() => validateRuntimeEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://db/app', REDIS_URL: 'redis://redis:6379', JWT_ACCESS_SECRET: 'replace-with-a-long-random-access-secret', JWT_REFRESH_SECRET: 'replace-with-a-long-random-refresh-secret', WEB_URL: 'http://localhost:3000', COOKIE_SECURE: 'false' })).toThrow(/JWT secrets|OPENAI_API_KEY|WEB_URL/);
  });

  it('rejects console email in production and accepts the configured provider contract', () => {
    expect(() => validateRuntimeEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://db/app', REDIS_URL: 'redis://redis:6379', JWT_ACCESS_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'b'.repeat(64), OPENAI_API_KEY: 'sk-test-only', WEB_URL: 'https://app.example.com', API_URL: 'https://api.example.com', PUBLIC_API_URL: 'https://api.example.com/api/v1', NEXT_PUBLIC_API_URL: 'https://app.example.com/api/v1', WIDGET_SCRIPT_URL: 'https://app.example.com/widget.js', COOKIE_SECURE: 'true', CORS_ALLOWED_ORIGINS: 'https://app.example.com', WEBHOOK_ENCRYPTION_KEY: 'w'.repeat(32) })).toThrow(/Console email|EMAIL_PROVIDER|Console and test email providers/);
  });

  it('rejects mock billing and local storage in production even when other values are valid', () => {
    expect(() => validateRuntimeEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://db/app', REDIS_URL: 'redis://redis:6379', JWT_ACCESS_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'b'.repeat(64), OPENAI_API_KEY: 'sk-test-only', WEB_URL: 'https://app.example.com', API_URL: 'https://api.example.com', PUBLIC_API_URL: 'https://api.example.com/api/v1', NEXT_PUBLIC_API_URL: 'https://app.example.com/api/v1', WIDGET_SCRIPT_URL: 'https://app.example.com/widget.js', COOKIE_SECURE: 'true', CORS_ALLOWED_ORIGINS: 'https://app.example.com', EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 'test-email-key', WEBHOOK_ENCRYPTION_KEY: 'w'.repeat(32) })).toThrow(/STORAGE_PROVIDER|BILLING_PROVIDER/);
  });

  it('accepts a complete production configuration', () => {
    const env = validateRuntimeEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://db/app', REDIS_URL: 'redis://redis:6379', JWT_ACCESS_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'b'.repeat(64), OPENAI_API_KEY: 'sk-test-only', WEB_URL: 'https://app.example.com', API_URL: 'https://api.example.com/api/v1', PUBLIC_API_URL: 'https://api.example.com/api/v1', NEXT_PUBLIC_API_URL: 'https://api.example.com/api/v1', WIDGET_SCRIPT_URL: 'https://app.example.com/widget.js', COOKIE_SECURE: 'true', CORS_ALLOWED_ORIGINS: 'https://app.example.com', STORAGE_PROVIDER: 's3', S3_REGION: 'us-east-1', S3_BUCKET: 'resolveai-private', S3_ACCESS_KEY_ID: 'access-key', S3_SECRET_ACCESS_KEY: 'secret-key', BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_only', STRIPE_WEBHOOK_SECRET: 'whsec_test_only', STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_BUSINESS: 'price_business', EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 'test-email-key', WEBHOOK_ENCRYPTION_KEY: 'w'.repeat(32) });
    expect(env.NODE_ENV).toBe('production');
    expect(env.OPENAI_GENERATION_MODEL).toBe('gpt-4o-mini');
  });
});
