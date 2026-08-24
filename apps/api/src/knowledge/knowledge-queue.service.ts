import { Injectable, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { redisConnectionOptionsFromEnv } from '@resolveai/config';

export const KNOWLEDGE_QUEUE = 'knowledge-processing';

@Injectable()
export class KnowledgeQueueService implements OnModuleDestroy {
  private readonly queue = new Queue(KNOWLEDGE_QUEUE, { connection: redisConnectionOptionsFromEnv() });
  async add(documentId: string, workspaceId: string): Promise<void> {
    try {
      const existing = await this.queue.getJob(documentId);
      if (existing) {
        const state = await existing.getState();
        if (['active', 'waiting', 'delayed', 'prioritized'].includes(state)) return;
        await existing.remove();
      }
      await this.queue.add('process-document', { documentId, workspaceId }, { jobId: documentId, attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 100 });
    } catch {
      throw new ServiceUnavailableException('Knowledge processing queue is unavailable');
    }
  }
  async onModuleDestroy(): Promise<void> { await this.queue.close(); }
}
