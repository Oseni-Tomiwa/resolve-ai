import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@resolveai/database';
import { getGenerationModel } from '@resolveai/config';
// Nest dependency injection needs the service constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GroundedAnswerService } from '../knowledge/grounded-answer.service';
import { defaultAgent, defaultAgentMaxOutputTokens, defaultAgentModel, defaultAgentProvider, defaultAgentTemperature } from './agent.config';
// Nest dependency injection needs this constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WebhookEventsService } from '../webhooks/webhook-events.service';
import type { AgentListQueryDto, AgentPlaygroundDto, CreateAgentDto, UpdateAgentDto } from './dto';
// Nest dependency injection needs this constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditLogService } from '../audit-log/audit-log.service';

const canManage = (organizationRole: string, workspaceRole: string): boolean => ['OWNER', 'ADMIN'].includes(organizationRole) || workspaceRole === 'ADMIN';
const slugify = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'agent';
const trimNullable = (value: string | null | undefined): string | null | undefined => value === undefined ? undefined : value?.trim() || null;
const agentDocumentInclude = { knowledgeDocuments: { select: { knowledgeDocumentId: true } } } as const;

@Injectable()
export class AgentsService {
  constructor(@Inject('PRISMA') private readonly db: PrismaClient, private readonly grounded: GroundedAnswerService, @Optional() private readonly audit?: AuditLogService, @Optional() private readonly events?: WebhookEventsService) {}

  private async access(userId: string, workspaceId: string) {
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const [organization, member] = await Promise.all([
      this.db.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId: workspace.organizationId } } }),
      this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } }),
    ]);
    if (!organization || (!member && !['OWNER', 'ADMIN'].includes(organization.role))) throw new ForbiddenException('Workspace membership required');
    return { organizationRole: organization.role, workspaceRole: member?.role ?? '' };
  }

  private async requireManager(userId: string, workspaceId: string) {
    const access = await this.access(userId, workspaceId);
    if (!canManage(access.organizationRole, access.workspaceRole)) throw new ForbiddenException('Insufficient workspace permissions');
    return access;
  }

  private view(agent: { id: string; workspaceId: string; name: string; slug: string; description: string | null; instructions: string; greeting: string | null; fallbackMessage: string | null; provider: string; model: string; temperature: number; topP: number; maxOutputTokens: number; requireCitations: boolean; groundedOnly: boolean; allowFollowUpQuestions: boolean; allowGeneralKnowledge: boolean; status: string; isDefault: boolean; publishedAt: Date | null; createdAt: Date; updatedAt: Date; knowledgeDocuments?: Array<{ knowledgeDocumentId: string }> }, includeConfiguration: boolean) {
    return { id: agent.id, workspaceId: agent.workspaceId, name: agent.name, slug: agent.slug, description: agent.description, greeting: agent.greeting, provider: agent.provider, model: agent.model, status: agent.status, isDefault: agent.isDefault, publishedAt: agent.publishedAt, selectedDocumentCount: agent.knowledgeDocuments?.length ?? 0, createdAt: agent.createdAt, updatedAt: agent.updatedAt, ...(includeConfiguration ? { instructions: agent.instructions, fallbackMessage: agent.fallbackMessage, temperature: agent.temperature, topP: agent.topP, maxOutputTokens: agent.maxOutputTokens, requireCitations: agent.requireCitations, groundedOnly: agent.groundedOnly, allowFollowUpQuestions: agent.allowFollowUpQuestions, allowGeneralKnowledge: agent.allowGeneralKnowledge, documentIds: agent.knowledgeDocuments?.map((item) => item.knowledgeDocumentId) ?? [] } : {}) };
  }

  private modelSelection(provider: string | undefined, model: string | undefined): { provider: string; model: string } {
    const selectedProvider = provider ?? defaultAgentProvider;
    const selectedModel = model ?? defaultAgentModel;
    if (!getGenerationModel(selectedProvider, selectedModel)) throw new ConflictException('The selected AI model is disabled or unsupported');
    return { provider: selectedProvider, model: selectedModel };
  }

  private async validateDocumentIds(workspaceId: string, documentIds: string[] | undefined): Promise<string[]> {
    const ids = [...new Set(documentIds ?? [])];
    if (!ids.length) return [];
    const documents = await this.db.knowledgeDocument.findMany({ where: { workspaceId, id: { in: ids }, status: 'READY', deletedAt: null }, select: { id: true } });
    if (documents.length !== ids.length) throw new ConflictException('Selected documents must be READY, active, and belong to this workspace');
    return ids;
  }

  private async syncDocuments(tx: Prisma.TransactionClient, workspaceId: string, agentId: string, documentIds: string[] | undefined): Promise<void> {
    if (documentIds === undefined) return;
    const ids = await this.validateDocumentIds(workspaceId, documentIds);
    await tx.agentKnowledgeDocument.deleteMany({ where: { agentId, workspaceId } });
    if (ids.length) await tx.agentKnowledgeDocument.createMany({ data: ids.map((knowledgeDocumentId) => ({ agentId, knowledgeDocumentId, workspaceId })) });
  }

  async ensureDefault(workspaceId: string, createdByUserId: string) {
    const existing = await this.db.aIAgent.findFirst({ where: { workspaceId, isDefault: true, deletedAt: null, status: 'ACTIVE' } });
    if (existing) return existing;
    try {
      return await this.db.aIAgent.create({ data: { workspaceId, createdByUserId, ...defaultAgent, provider: defaultAgentProvider, model: defaultAgentModel, temperature: defaultAgentTemperature, topP: 1, maxOutputTokens: defaultAgentMaxOutputTokens, status: 'ACTIVE', isDefault: true } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const created = await this.db.aIAgent.findFirst({ where: { workspaceId, isDefault: true, deletedAt: null, status: 'ACTIVE' } });
      if (!created) throw error;
      return created;
    }
  }

  async requireActiveForConversation(userId: string, workspaceId: string, agentId: string) {
    await this.access(userId, workspaceId);
    const agent = await this.db.aIAgent.findFirst({ where: { id: agentId, workspaceId, deletedAt: null, status: 'ACTIVE' }, include: agentDocumentInclude });
    if (!agent) throw new NotFoundException('Active agent not found');
    return agent;
  }

  async requireActiveForGeneration(workspaceId: string, agentId: string): Promise<Prisma.AIAgentGetPayload<{ include: typeof agentDocumentInclude }>> {
    const agent = await this.db.aIAgent.findFirst({ where: { id: agentId, workspaceId, deletedAt: null, status: 'ACTIVE' }, include: agentDocumentInclude });
    if (!agent) throw new ConflictException('This agent is no longer active');
    return agent;
  }

  async create(userId: string, workspaceId: string, dto: CreateAgentDto) {
    await this.requireManager(userId, workspaceId);
    const existingCount = await this.db.aIAgent.count({ where: { workspaceId, deletedAt: null } });
    const shouldBeDefault = dto.isDefault === true || existingCount === 0;
    const documentIds = await this.validateDocumentIds(workspaceId, dto.documentIds);
    const selection = this.modelSelection(dto.provider, dto.model);
    const data = { workspaceId, createdByUserId: userId, name: dto.name.trim(), slug: slugify(dto.slug ?? dto.name), description: trimNullable(dto.description) ?? null, instructions: dto.instructions.trim(), greeting: trimNullable(dto.greeting) ?? null, fallbackMessage: trimNullable(dto.fallbackMessage) ?? null, ...selection, temperature: dto.temperature ?? defaultAgentTemperature, topP: dto.topP ?? 1, maxOutputTokens: dto.maxOutputTokens ?? defaultAgentMaxOutputTokens, requireCitations: dto.requireCitations ?? true, groundedOnly: dto.groundedOnly ?? true, allowFollowUpQuestions: dto.allowFollowUpQuestions ?? true, allowGeneralKnowledge: dto.allowGeneralKnowledge ?? false, status: shouldBeDefault ? 'ACTIVE' as const : dto.status ?? 'DRAFT' as const, isDefault: shouldBeDefault };
    try {
      const agent = await this.db.$transaction(async (tx) => {
        if (shouldBeDefault) await tx.aIAgent.updateMany({ where: { workspaceId, isDefault: true, deletedAt: null }, data: { isDefault: false } });
        const created = await tx.aIAgent.create({ data });
        if (documentIds.length) await tx.agentKnowledgeDocument.createMany({ data: documentIds.map((knowledgeDocumentId) => ({ agentId: created.id, knowledgeDocumentId, workspaceId })) });
        return created;
      });
      await this.audit?.record({ organizationId: (await this.db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } }))!.organizationId, workspaceId, actorUserId: userId, action: 'agent.created', targetType: 'ai_agent', targetId: agent.id, metadata: { status: agent.status } });
      await this.audit?.record({ organizationId: (await this.db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } }))!.organizationId, workspaceId, actorUserId: userId, action: 'agent.updated', targetType: 'ai_agent', targetId: agent.id, metadata: { status: agent.status } });
      return this.view(agent, true);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('An agent with this name already exists in the workspace');
      throw error;
    }
  }

  async list(userId: string, workspaceId: string, query: AgentListQueryDto) {
    const access = await this.access(userId, workspaceId);
    const agentCount = await this.db.aIAgent.count({ where: { workspaceId, deletedAt: null } });
    if (agentCount === 0) await this.ensureDefault(workspaceId, userId);
    const includeConfiguration = canManage(access.organizationRole, access.workspaceRole);
    const where: Prisma.AIAgentWhereInput = { workspaceId, deletedAt: null, ...(includeConfiguration ? {} : { status: 'ACTIVE' }), ...(query.search?.trim() ? { name: { contains: query.search.trim(), mode: 'insensitive' } } : {}) };
    const include = agentDocumentInclude;
    const [items, total] = await this.db.$transaction([this.db.aIAgent.findMany({ where, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, include }), this.db.aIAgent.count({ where })]);
    return { items: items.map((agent) => this.view(agent, includeConfiguration)), page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total };
  }

  async detail(userId: string, workspaceId: string, agentId: string) {
    const access = await this.access(userId, workspaceId);
    const includeConfiguration = canManage(access.organizationRole, access.workspaceRole);
    const agent = await this.db.aIAgent.findFirst({ where: { id: agentId, workspaceId, deletedAt: null, ...(includeConfiguration ? {} : { status: 'ACTIVE' }) }, include: agentDocumentInclude });
    if (!agent) throw new NotFoundException('Agent not found');
    return this.view(agent, includeConfiguration);
  }

  async update(userId: string, workspaceId: string, agentId: string, dto: UpdateAgentDto) {
    await this.requireManager(userId, workspaceId);
    const current = await this.db.aIAgent.findFirst({ where: { id: agentId, workspaceId, deletedAt: null } });
    if (!current) throw new NotFoundException('Agent not found');
    if (current.status === 'ACTIVE' && dto.status === 'DRAFT') throw new ConflictException('Published agents cannot be edited in place; duplicate the agent to create a draft');
    if (current.isDefault && dto.status && dto.status !== 'ACTIVE') throw new ConflictException('Choose another default agent before disabling this agent');
    if (dto.isDefault === true && (dto.status ?? current.status) !== 'ACTIVE') throw new ConflictException('Only active agents can be the workspace default');
    const documentIds = dto.documentIds === undefined ? undefined : await this.validateDocumentIds(workspaceId, dto.documentIds);
    const selection = dto.provider !== undefined || dto.model !== undefined ? this.modelSelection(dto.provider ?? current.provider, dto.model ?? current.model) : undefined;
    const data = { ...(dto.name === undefined ? {} : { name: dto.name.trim() }), ...(dto.slug === undefined ? {} : { slug: slugify(dto.slug) }), ...(dto.description === undefined ? {} : { description: trimNullable(dto.description) }), ...(dto.instructions === undefined ? {} : { instructions: dto.instructions.trim() }), ...(dto.greeting === undefined ? {} : { greeting: trimNullable(dto.greeting) }), ...(dto.fallbackMessage === undefined ? {} : { fallbackMessage: trimNullable(dto.fallbackMessage) }), ...(selection ?? {}), ...(dto.temperature === undefined ? {} : { temperature: dto.temperature }), ...(dto.topP === undefined ? {} : { topP: dto.topP }), ...(dto.maxOutputTokens === undefined ? {} : { maxOutputTokens: dto.maxOutputTokens }), ...(dto.requireCitations === undefined ? {} : { requireCitations: dto.requireCitations }), ...(dto.groundedOnly === undefined ? {} : { groundedOnly: dto.groundedOnly }), ...(dto.allowFollowUpQuestions === undefined ? {} : { allowFollowUpQuestions: dto.allowFollowUpQuestions }), ...(dto.allowGeneralKnowledge === undefined ? {} : { allowGeneralKnowledge: dto.allowGeneralKnowledge }), ...(dto.status === undefined ? {} : { status: dto.status }), ...(dto.isDefault === undefined ? {} : { isDefault: dto.isDefault }) };
    try {
      const agent = await this.db.$transaction(async (tx) => {
        if (dto.isDefault === true) await tx.aIAgent.updateMany({ where: { workspaceId, isDefault: true, deletedAt: null, id: { not: agentId } }, data: { isDefault: false } });
        const updated = await tx.aIAgent.update({ where: { id: agentId }, data });
        await this.syncDocuments(tx, workspaceId, agentId, documentIds);
        return updated;
      });
      return this.view(agent, true);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('An agent with this name already exists in the workspace');
      throw error;
    }
  }

  async setDefault(userId: string, workspaceId: string, agentId: string) {
    await this.requireManager(userId, workspaceId);
    const agent = await this.db.aIAgent.findFirst({ where: { id: agentId, workspaceId, deletedAt: null, status: 'ACTIVE' } });
    if (!agent) throw new NotFoundException('Active agent not found');
    const selected = await this.db.$transaction(async (tx) => { await tx.aIAgent.updateMany({ where: { workspaceId, isDefault: true, deletedAt: null }, data: { isDefault: false } }); return tx.aIAgent.update({ where: { id: agentId }, data: { isDefault: true } }); });
    return this.view(selected, true);
  }

  async remove(userId: string, workspaceId: string, agentId: string): Promise<void> {
    await this.requireManager(userId, workspaceId);
    const agent = await this.db.aIAgent.findFirst({ where: { id: agentId, workspaceId, deletedAt: null } });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.isDefault) throw new ConflictException('Choose another default agent before deleting this agent');
    await this.db.aIAgent.update({ where: { id: agentId }, data: { deletedAt: new Date(), status: 'DISABLED' } });
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
    if (workspace) await this.audit?.record({ organizationId: workspace.organizationId, workspaceId, actorUserId: userId, action: 'agent.deleted', targetType: 'ai_agent', targetId: agentId });
  }

  async duplicate(userId: string, workspaceId: string, agentId: string) {
    await this.requireManager(userId, workspaceId);
    const current = await this.db.aIAgent.findFirst({ where: { id: agentId, workspaceId, deletedAt: null }, include: agentDocumentInclude });
    if (!current) throw new NotFoundException('Agent not found');
    const name = `${current.name} Copy`;
    return this.create(userId, workspaceId, { name, slug: `${current.slug}-copy`, description: current.description ?? undefined, instructions: current.instructions, greeting: current.greeting ?? undefined, fallbackMessage: current.fallbackMessage ?? undefined, provider: current.provider, model: current.model, temperature: current.temperature, topP: current.topP, maxOutputTokens: current.maxOutputTokens, requireCitations: current.requireCitations, groundedOnly: current.groundedOnly, allowFollowUpQuestions: current.allowFollowUpQuestions, allowGeneralKnowledge: current.allowGeneralKnowledge, documentIds: current.knowledgeDocuments.map((item) => item.knowledgeDocumentId), isDefault: false });
  }

  async publish(userId: string, workspaceId: string, agentId: string) {
    await this.requireManager(userId, workspaceId);
    const current = await this.db.aIAgent.findFirst({ where: { id: agentId, workspaceId, deletedAt: null } });
    if (!current) throw new NotFoundException('Agent not found');
    if (!current.name.trim() || !current.instructions.trim()) throw new ConflictException('Name and instructions are required before publishing');
    const published = await this.db.aIAgent.update({ where: { id: agentId }, data: { status: 'ACTIVE', publishedAt: new Date(), publishedByUserId: userId }, include: agentDocumentInclude });
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
    if (workspace) await this.audit?.record({ organizationId: workspace.organizationId, workspaceId, actorUserId: userId, action: 'agent.published', targetType: 'ai_agent', targetId: agentId });
    return this.view(published, true);
  }

  async archive(userId: string, workspaceId: string, agentId: string) {
    await this.requireManager(userId, workspaceId);
    const current = await this.db.aIAgent.findFirst({ where: { id: agentId, workspaceId, deletedAt: null } });
    if (!current) throw new NotFoundException('Agent not found');
    if (current.isDefault) throw new ConflictException('Choose another default agent before archiving this agent');
    const archived = await this.db.aIAgent.update({ where: { id: agentId }, data: { status: 'ARCHIVED', deletedAt: new Date() } });
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
    if (workspace) await this.audit?.record({ organizationId: workspace.organizationId, workspaceId, actorUserId: userId, action: 'agent.archived', targetType: 'ai_agent', targetId: agentId });
    return archived;
  }

  async selectableDocuments(userId: string, workspaceId: string) {
    await this.access(userId, workspaceId);
    return this.db.knowledgeDocument.findMany({ where: { workspaceId, status: 'READY', deletedAt: null }, select: { id: true, name: true, originalFileName: true, status: true, updatedAt: true }, orderBy: { name: 'asc' } });
  }

  async playground(userId: string, workspaceId: string, agentId: string, dto: AgentPlaygroundDto) {
    await this.requireManager(userId, workspaceId);
    const agent = await this.db.aIAgent.findFirst({ where: { id: agentId, workspaceId, deletedAt: null }, include: agentDocumentInclude });
    if (!agent) throw new NotFoundException('Agent not found');
    const startedAt = Date.now();
    const prepared = await this.grounded.prepare(userId, workspaceId, dto.question, undefined, { instructions: agent.instructions, fallbackMessage: agent.fallbackMessage, provider: agent.provider, model: agent.model, temperature: agent.temperature, topP: agent.topP, maxOutputTokens: agent.maxOutputTokens, documentIds: agent.knowledgeDocuments?.map((item) => item.knowledgeDocumentId) ?? [], requireCitations: agent.requireCitations, groundedOnly: agent.groundedOnly, allowGeneralKnowledge: agent.allowGeneralKnowledge });
    if (prepared.insufficient) return { answer: agent.fallbackMessage ?? 'I couldn’t find enough information in the selected knowledge documents to answer that.', sources: [], metadata: { model: null, retrievalResultCount: 0, latencyMs: Date.now() - startedAt, insufficientContext: true, published: false } };
    const generated = await this.grounded.completePrepared({ question: prepared.question, context: prepared.context, instructions: prepared.instructions, maximumOutputTokens: prepared.maximumOutputTokens, provider: prepared.provider, model: prepared.model, temperature: prepared.temperature, topP: prepared.topP });
    if (prepared.requireCitations && generated.citedSourceNumbers.length === 0) return { answer: agent.fallbackMessage ?? 'I couldn’t validate citations for this answer.', sources: [], metadata: { model: generated.model, provider: generated.provider, usage: generated.usage, retrievalResultCount: prepared.selected.length, latencyMs: Date.now() - startedAt, insufficientContext: true, published: false } };
    return { answer: generated.answer, sources: this.grounded.sourcesFor(prepared, generated.citedSourceNumbers), metadata: { model: generated.model, provider: generated.provider, usage: generated.usage, retrievalResultCount: prepared.selected.length, latencyMs: Date.now() - startedAt, insufficientContext: false, published: false } };
  }
}
