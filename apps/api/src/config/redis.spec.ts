import { redisConnectionOptions, redisConnectionOptionsFromEnv } from '@resolveai/config';

describe('Redis connection configuration', () => {
  it('parses a non-local Redis URL without falling back to localhost', () => {
    expect(redisConnectionOptions('redis://example.invalid:6399')).toMatchObject({ host: 'example.invalid', port: 6399, maxRetriesPerRequest: 1 });
  });

  it('preserves credentials and TLS for managed Redis', () => {
    expect(redisConnectionOptions('rediss://worker:p%40ss@example.invalid:6380', 'worker')).toMatchObject({ host: 'example.invalid', port: 6380, username: 'worker', password: 'p@ss', tls: {}, maxRetriesPerRequest: null });
  });

  it('does not allow a production Redis fallback', () => {
    expect(() => redisConnectionOptionsFromEnv({ NODE_ENV: 'production' })).toThrow('REDIS_URL is required');
  });
});
