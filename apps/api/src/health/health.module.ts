import { Controller, Get, HttpStatus, Inject, Module, Res } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Response } from 'express';
import type { PrismaClient } from '@resolveai/database';
import { redisConnectionOptionsFromEnv } from '@resolveai/config';

type DependencyStatus = 'ok' | 'unavailable';

@Controller('health')
export class HealthController {
  private readonly redis = new Redis(redisConnectionOptionsFromEnv());
  constructor(@Inject('PRISMA') private readonly db: PrismaClient) {}

  @Get()
  check(): { success: true; message: string; data: { status: 'ok' } } { return { success: true, message: 'Service is healthy', data: { status: 'ok' } }; }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<{ success: boolean; message: string; data: { status: string; dependencies: { database: DependencyStatus; redis: DependencyStatus } } }> {
    const [database, redis] = await Promise.all([
      this.db.$queryRawUnsafe('SELECT 1').then(() => 'ok' as const).catch(() => 'unavailable' as const),
      this.redisReady(),
    ]);
    const ready = database === 'ok' && redis === 'ok';
    if (!ready) response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { success: ready, message: ready ? 'Service is ready' : 'Service dependencies are not ready', data: { status: ready ? 'ready' : 'degraded', dependencies: { database, redis } } };
  }

  private async redisReady(): Promise<DependencyStatus> { try { if (this.redis.status === 'wait') await this.redis.connect(); await this.redis.ping(); return 'ok'; } catch { return 'unavailable'; } }

  async onModuleDestroy(): Promise<void> { await this.redis.quit().catch(() => undefined); }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
