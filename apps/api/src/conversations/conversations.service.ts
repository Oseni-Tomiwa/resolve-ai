import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@resolveai/database';
// Nest dependency injection needs these constructors at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GroundedAnswerService } from '../knowledge/grounded-answer.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkspaceAccessService } from '../workspace-access/workspace-access.service';
// Agent service is injected by the ConversationsModule.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AgentsService } from '../agents/agents.service';
// Nest dependency injection needs this constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WebhookEventsService } from '../webhooks/webhook-events.service';
import type { ConversationDetailQueryDto, ConversationListQueryDto, CreateConversationDto, StreamMessageDto, UpdateConversationDto } from './dto';
// Nest dependency injection needs this service constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BillingUsageService } from '../billing/billing-usage.service';

type ClientEvent =
  | { type: 'message.started'; messageId: string }
  | { type: 'message.delta'; delta: string }
  | { type: 'sources'; sources: ReturnType<GroundedAnswerService['sourcesFor']> }
  | { type: 'message.completed'; message: ReturnType<ConversationsService['messageView']> }
  | { type: 'message.failed'; error: { code: string; message: string } };

const safeFailure = { code: 'GENERATION_FAILED', message: 'ResolveAI could not complete this response.' };
const insufficientAnswer = 'I couldn’t find enough information in this workspace’s knowledge base to answer that.';
const canWrite = (organizationRole: string, workspaceRole: string): boolean => ['OWNER', 'ADMIN'].includes(organizationRole) || ['ADMIN', 'AGENT'].includes(workspaceRole);
const titleFromMessage = (content: string): string => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 56) return normalized || 'New conversation';
  return `${normalized.slice(0, 56).replace(/\s+\S*$/, '').trim()}…`;
};

@Injectable()
export class ConversationsService {
  constructor(@Inject('PRISMA') private readonly db: PrismaClient, private readonly workspaceAccess: WorkspaceAccessService, private readonly grounded: GroundedAnswerService, private readonly agents: AgentsService, @Optional() private readonly billingUsage?: BillingUsageService, @Optional() private readonly events?: WebhookEventsService) {}

  async create(userId: string, workspaceId: string, dto: CreateConversationDto) {
    const access = await this.workspaceAccess.getAccess(userId, workspaceId);
    if (!canWrite(access.organizationRole, access.workspaceRole)) throw new ForbiddenException('Viewers cannot create conversations');
    await this.billingUsage?.assertCanConsume(workspaceId, 'CONVERSATIONS');
    const agent = dto.agentId ? await this.agents.requireActiveForConversation(userId, workspaceId, dto.agentId) : await this.agents.ensureDefault(workspaceId, userId);
    const created = await this.db.aIConversation.create({ data: { workspaceId, createdByUserId: userId, agentId: agent.id, title: dto.title?.trim() || 'New conversation' }, select: { id: true, workspaceId: true, title: true, status: true, agent: { select: { id: true, name: true, description: true, greeting: true } }, createdAt: true, updatedAt: true, lastMessageAt: true } }); void this.events?.publish(workspaceId, 'conversation.created', { conversationId: created.id, userId, agentId: agent.id }, 'conversation.created:' + workspaceId + ':' + created.id); return created;
  }

  async list(userId: string, workspaceId: string, query: ConversationListQueryDto) {
    await this.workspaceAccess.assertMember(userId, workspaceId);
    const page = query.page ?? 1; const pageSize = query.pageSize ?? 20;
    const where = { workspaceId, deletedAt: null, ...(query.search?.trim() ? { title: { contains: query.search.trim(), mode: 'insensitive' as const } } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.aIConversation.findMany({ where, orderBy: { lastMessageAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, workspaceId: true, title: true, status: true, createdAt: true, updatedAt: true, lastMessageAt: true } }),
      this.db.aIConversation.count({ where }),
    ]);
    return { items, page, pageSize, total, hasMore: page * pageSize < total };
  }

  async detail(userId: string, workspaceId: string, conversationId: string, query: ConversationDetailQueryDto) {
    await this.workspaceAccess.assertMember(userId, workspaceId);
    const conversation = await this.db.aIConversation.findFirst({ where: { id: conversationId, workspaceId, deletedAt: null }, select: { id: true, workspaceId: true, title: true, status: true, agentId: true, agent: { select: { id: true, name: true, description: true, greeting: true } }, createdAt: true, updatedAt: true, lastMessageAt: true } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const page = query.page ?? 1; const pageSize = query.pageSize ?? 50;
    const [messages, total] = await this.db.$transaction([
      this.db.aIMessage.findMany({ where: { conversationId, workspaceId, status: { in: ['COMPLETE', 'FAILED', 'CANCELLED'] } }, orderBy: { createdAt: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: { sources: { orderBy: { sourceNumber: 'asc' } } } }),
      this.db.aIMessage.count({ where: { conversationId, workspaceId, status: { in: ['COMPLETE', 'FAILED', 'CANCELLED'] } } }),
    ]);
    return { conversation, messages: messages.map((message) => this.messageView(message)), page, pageSize, total, hasMore: page * pageSize < total };
  }

  async rename(userId: string, workspaceId: string, conversationId: string, dto: UpdateConversationDto) {
    const access = await this.workspaceAccess.getAccess(userId, workspaceId);
    if (!canWrite(access.organizationRole, access.workspaceRole)) throw new ForbiddenException('Viewers cannot rename conversations');
    await this.requireConversation(workspaceId, conversationId);
    return this.db.aIConversation.update({ where: { id: conversationId }, data: { title: dto.title.trim() }, select: { id: true, workspaceId: true, title: true, status: true, createdAt: true, updatedAt: true, lastMessageAt: true } });
  }

  async remove(userId: string, workspaceId: string, conversationId: string): Promise<void> {
    const access = await this.workspaceAccess.getAccess(userId, workspaceId);
    if (!canWrite(access.organizationRole, access.workspaceRole)) throw new ForbiddenException('Viewers cannot delete conversations');
    await this.requireConversation(workspaceId, conversationId);
    await this.db.aIConversation.update({ where: { id: conversationId }, data: { deletedAt: new Date(), generationLockAt: null } });
  }

  async *stream(userId: string, workspaceId: string, conversationId: string, dto: StreamMessageDto, signal: AbortSignal): AsyncIterable<ClientEvent> {
    const access = await this.workspaceAccess.getAccess(userId, workspaceId);
    if (!canWrite(access.organizationRole, access.workspaceRole)) throw new ForbiddenException('Viewers cannot send messages');
    const content = dto.content.trim();
    if (!content) throw new BadRequestException('Message cannot be empty');
    await this.billingUsage?.assertCanConsume(workspaceId, 'AI_REQUESTS');
    const conversation = await this.requireConversation(workspaceId, conversationId);
    const lockAt = new Date();
    const locked = await this.db.aIConversation.updateMany({ where: { id: conversation.id, workspaceId, deletedAt: null, OR: [{ generationLockAt: null }, { generationLockAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } }] }, data: { generationLockAt: lockAt } });
    if (locked.count !== 1) throw new ConflictException('This conversation is already generating a response');

    let assistantId: string | null = null;
    try {
      const previous = await this.db.aIMessage.findMany({ where: { conversationId, workspaceId, role: { in: ['USER', 'ASSISTANT'] }, status: 'COMPLETE' }, orderBy: { createdAt: 'desc' }, take: 12, select: { role: true, content: true } });
      const history = previous.reverse().map((message) => `${message.role === 'USER' ? 'User' : 'Assistant'}: ${message.content}`).join('\n').slice(-8000);
      const created = await this.db.$transaction(async (tx) => {
        const userMessage = await tx.aIMessage.create({ data: { conversationId, workspaceId, userId, role: 'USER', content, status: 'COMPLETE' } });
        const assistant = await tx.aIMessage.create({ data: { conversationId, workspaceId, role: 'ASSISTANT', content: '', status: 'PENDING' } });
        await tx.aIConversation.update({ where: { id: conversationId }, data: { title: conversation.title === 'New conversation' ? titleFromMessage(content) : undefined, lastMessageAt: userMessage.createdAt } });
        return assistant;
      });
      assistantId = created.id;
      yield { type: 'message.started', messageId: assistantId };
      const agentId = conversation.agentId ?? (await this.agents.ensureDefault(workspaceId, userId)).id;
      const agent = await this.agents.requireActiveForGeneration(workspaceId, agentId);
      const prepared = await this.grounded.prepare(userId, workspaceId, content, undefined, { instructions: agent.instructions, fallbackMessage: agent.fallbackMessage, provider: agent.provider, model: agent.model, temperature: agent.temperature, topP: agent.topP, maxOutputTokens: agent.maxOutputTokens, documentIds: agent.knowledgeDocuments?.map((item) => item.knowledgeDocumentId) ?? [], requireCitations: agent.requireCitations, groundedOnly: agent.groundedOnly, allowGeneralKnowledge: agent.allowGeneralKnowledge });
      if (prepared.insufficient) {
        const fallback = agent.fallbackMessage ?? insufficientAnswer;
        await this.completeAssistant(assistantId, workspaceId, conversationId, fallback, null, prepared.model, { inputTokens: 0, outputTokens: 0 }, [], agent);
        yield { type: 'message.delta', delta: fallback };
        yield { type: 'sources', sources: [] };
        yield { type: 'message.completed', message: await this.completedMessage(assistantId, workspaceId) };
        return;
      }
      await this.db.aIMessage.update({ where: { id: assistantId }, data: { status: 'STREAMING' } });
      const deltas: string[] = [];
      let usage = { inputTokens: 0, outputTokens: 0 };
      for await (const event of this.grounded.streamPrepared({ question: prepared.question, context: prepared.context, instructions: prepared.instructions, conversationContext: history, maximumOutputTokens: prepared.maximumOutputTokens, provider: prepared.provider, model: prepared.model, temperature: prepared.temperature, topP: prepared.topP }, signal)) {
        if (event.type === 'response.delta') { if (event.delta.length > 0) { deltas.push(event.delta); yield { type: 'message.delta', delta: event.delta }; } }
        if (event.type === 'response.completed') usage = event.usage;
        if (event.type === 'response.failed') throw new ServiceUnavailableException('Grounded answer generation failed');
      }
      const answer = deltas.join('').trim();
      if (!answer) throw new ServiceUnavailableException('Grounded answer generation returned an empty response');
      const cited = Array.from(answer.matchAll(/\[(\d+)\]/g), (match) => Number(match[1]));
      const sources = this.grounded.sourcesFor(prepared, cited);
      await this.completeAssistant(assistantId, workspaceId, conversationId, answer, prepared.provider, prepared.model, usage, sources, agent);
      yield { type: 'sources', sources };
      yield { type: 'message.completed', message: await this.completedMessage(assistantId, workspaceId) };
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'AbortError';
      if (assistantId) {
        await this.db.aIMessage.update({ where: { id: assistantId }, data: { status: cancelled ? 'CANCELLED' : 'FAILED', errorCode: cancelled ? 'CANCELLED' : 'GENERATION_FAILED' } }).catch(() => undefined);
      }
      if (!cancelled) yield { type: 'message.failed', error: safeFailure };
    } finally {
      await this.db.aIConversation.updateMany({ where: { id: conversationId, workspaceId }, data: { generationLockAt: null } }).catch(() => undefined);
    }
  }

  private async requireConversation(workspaceId: string, conversationId: string) {
    const conversation = await this.db.aIConversation.findFirst({ where: { id: conversationId, workspaceId, deletedAt: null }, include: { agent: true } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  private async completeAssistant(messageId: string, workspaceId: string, conversationId: string, content: string, provider: string | null, model: string | null, usage: { inputTokens: number; outputTokens: number }, sources: ReturnType<GroundedAnswerService['sourcesFor']>, agent?: { id: string; name: string }): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.aIMessage.update({ where: { id: messageId }, data: { content, status: 'COMPLETE', provider, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, agentId: agent?.id, agentNameSnapshot: agent?.name } });
      if (sources.length > 0) await tx.aIMessageSource.createMany({ data: sources.map((source) => ({ messageId, workspaceId, documentId: source.documentId, chunkId: source.chunkId, sourceNumber: source.number, documentNameSnapshot: source.documentName, chunkIndexSnapshot: source.chunkIndex, contentPreview: source.contentPreview, similarityScore: source.similarityScore, cited: source.cited })) });
      await tx.aIConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
    });
  }

  private async completedMessage(messageId: string, workspaceId: string) {
    const message = await this.db.aIMessage.findFirst({ where: { id: messageId, workspaceId }, include: { sources: { orderBy: { sourceNumber: 'asc' } } } });
    if (!message) throw new NotFoundException('Assistant message not found');
    return this.messageView(message);
  }

  messageView(message: { id: string; conversationId: string; workspaceId: string; userId?: string | null; role: string; content: string; status: string; provider?: string | null; model?: string | null; inputTokens?: number | null; outputTokens?: number | null; errorCode?: string | null; agentId?: string | null; agentNameSnapshot?: string | null; createdAt: Date; sources?: Array<{ id: string; sourceNumber: number; documentId: string; chunkId: string; documentNameSnapshot: string; chunkIndexSnapshot: number; contentPreview: string; similarityScore: number; cited: boolean }> }) {
    return { id: message.id, conversationId: message.conversationId, workspaceId: message.workspaceId, userId: message.userId ?? null, role: message.role, content: message.content, status: message.status, provider: message.provider ?? null, model: message.model ?? null, agentId: message.agentId ?? null, agentName: message.agentNameSnapshot ?? null, inputTokens: message.inputTokens ?? null, outputTokens: message.outputTokens ?? null, errorCode: message.errorCode ?? null, createdAt: message.createdAt, sources: (message.sources ?? []).map((source) => ({ id: source.id, number: source.sourceNumber, documentId: source.documentId, chunkId: source.chunkId, documentName: source.documentNameSnapshot, chunkIndex: source.chunkIndexSnapshot, contentPreview: source.contentPreview, similarityScore: source.similarityScore, cited: source.cited })) };
  }
}
