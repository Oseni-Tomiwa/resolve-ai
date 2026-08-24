import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { redisConnectionOptionsFromEnv } from '@resolveai/config';

@Injectable()
export class RateLimitService {
  private static readonly maxLocalBuckets = 10_000;
  private readonly buckets = new Map<string, number[]>();
  private readonly redis = process.env.NODE_ENV === 'production' ? new Redis(redisConnectionOptionsFromEnv()) : null;

  allow(key: string, maximum: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (this.buckets.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= maximum) { this.buckets.set(key, recent); return false; }
    if (recent.length === 0) this.buckets.delete(key);
    if (!this.buckets.has(key) && this.buckets.size >= RateLimitService.maxLocalBuckets) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey) this.buckets.delete(oldestKey);
    }
    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }

  async allowDistributed(key: string, maximum: number, windowMs: number): Promise<boolean> {
    if (!this.redis) return this.allow(key, maximum, windowMs);
    try {
      const result = await this.redis.eval('local count = redis.call("INCR", KEYS[1]); if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]); end; return count <= tonumber(ARGV[2])', 1, `resolveai:rate:${key}`, windowMs, maximum);
      return Number(result) === 1;
    } catch {
      throw new ServiceUnavailableException('Rate limiting is temporarily unavailable');
    }
  }

  async onModuleDestroy(): Promise<void> { await this.redis?.quit().catch(() => undefined); }
}
