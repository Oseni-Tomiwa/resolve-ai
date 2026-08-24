import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { PrismaClient } from '@resolveai/database';
import { createStorageFromEnv, LocalStorage } from '@resolveai/storage';
import type { Express } from 'express';
import { isBlockedHostname, isPrivateOrReservedAddress } from '@resolveai/shared';
// Nest dependency injection needs this constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { KnowledgeQueueService } from './knowledge-queue.service';
import type { KnowledgeChunkQueryDto, KnowledgeListQueryDto } from './dto';
// Nest dependency injection needs this service constructor at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BillingUsageService } from '../billing/billing-usage.service';

const allowedMimeTypes = new Set(['application/pdf', 'text/plain', 'text/markdown', 'text/x-markdown', 'text/html']);
const maxFileSize = Number(process.env.KNOWLEDGE_MAX_FILE_SIZE_BYTES ?? 10 * 1024 * 1024);
const safeName = (name: string): string => name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160) || 'document';
const publicDocument = (document: Record<string, unknown>) => { const { storageKey: _storageKey, extractedText: _extractedText, _count: _documentCount, ...metadata } = document; return metadata; };
async function assertPublicUrl(value: string): Promise<URL> { let url: URL; try { url = new URL(value); } catch { throw new ConflictException('Enter a valid public http or https URL'); } if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new ConflictException('Only public http and https URLs are supported'); if (isBlockedHostname(url.hostname)) throw new ConflictException('Private and local network URLs are not allowed'); const addresses = await lookup(url.hostname, { all: true }); if (!addresses.length || addresses.some((address) => isPrivateOrReservedAddress(address.address))) throw new ConflictException('Private and local network URLs are not allowed'); return url; }
type Access = { organizationRole: string; workspaceRole: string; organizationId: string };
type DocumentStatus = 'UPLOADED' | 'PROCESSING' | 'EMBEDDING' | 'READY' | 'FAILED';

@Injectable()
export class KnowledgeService {
  private readonly storage = typeof createStorageFromEnv === 'function' ? createStorageFromEnv(process.env) : new LocalStorage(process.env.KNOWLEDGE_STORAGE_DIR);
  constructor(@Inject('PRISMA') private readonly db: PrismaClient, private readonly queue: KnowledgeQueueService, @Optional() private readonly billingUsage?: BillingUsageService) {}

  private async access(userId: string, workspaceId: string): Promise<Access> {
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const [organizationMember, workspaceMember] = await Promise.all([
      this.db.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId: workspace.organizationId } } }),
      this.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } }),
    ]);
    if (!organizationMember || (!workspaceMember && !['OWNER', 'ADMIN'].includes(organizationMember.role))) throw new ForbiddenException('Workspace membership required');
    return { organizationId: workspace.organizationId, organizationRole: organizationMember.role, workspaceRole: workspaceMember?.role ?? '' };
  }
  private async requireUploadAccess(userId: string, workspaceId: string): Promise<Access> { const access = await this.access(userId, workspaceId); if (access.workspaceRole === 'VIEWER') throw new ForbiddenException('Viewer access cannot upload documents'); return access; }
  private async requireDeleteAccess(userId: string, workspaceId: string): Promise<Access> { const access = await this.access(userId, workspaceId); if (access.workspaceRole !== 'ADMIN' && !['OWNER', 'ADMIN'].includes(access.organizationRole)) throw new ForbiddenException('Insufficient permissions to delete documents'); return access; }
  private async embeddingSummary(documentId: string, chunkCount: number, status: DocumentStatus) { const [embeddedChunkCount, latest] = await Promise.all([this.db.knowledgeEmbedding.count({ where: { documentId } }), this.db.knowledgeEmbedding.findFirst({ where: { documentId }, orderBy: { updatedAt: 'desc' }, select: { provider: true, model: true, dimensions: true } })]); return { chunkCount, embeddedChunkCount, embeddingProvider: latest?.provider ?? null, embeddingModel: latest?.model ?? null, embeddingDimensions: latest?.dimensions ?? null, embeddingStatus: status === 'FAILED' ? 'FAILED' : status === 'EMBEDDING' ? 'PROCESSING' : embeddedChunkCount === chunkCount && chunkCount > 0 ? 'COMPLETE' : 'NOT_STARTED' }; }

  async upload(userId: string, workspaceId: string, file: Express.Multer.File) {
    await this.requireUploadAccess(userId, workspaceId);
    if (!file || !file.buffer || file.size === 0) throw new ConflictException('The uploaded file is empty');
    if (file.size > maxFileSize) throw new ConflictException('Files must be 10 MB or smaller');
    if (!allowedMimeTypes.has(file.mimetype)) throw new ConflictException('Unsupported file type. Use PDF, TXT, or Markdown.');
    await this.billingUsage?.assertCanConsume(workspaceId, 'DOCUMENTS');
    await this.billingUsage?.assertCanConsume(workspaceId, 'STORAGE', file.size);
    const id = randomUUID(); const originalFileName = file.originalname.normalize('NFKC').slice(0, 255); const storageKey = `knowledge/${workspaceId}/${id}/${safeName(originalFileName)}`;
    const duplicate = await this.db.knowledgeDocument.findFirst({ where: { workspaceId, deletedAt: null, originalFileName, mimeType: file.mimetype, sizeBytes: file.size, status: { not: 'FAILED' } }, select: { id: true, name: true, status: true } });
    if (duplicate) throw new ConflictException(`This document is already in the workspace (${duplicate.name})`);
    await this.storage.save(storageKey, file.buffer);
    try {
      const document = await this.db.knowledgeDocument.create({ data: { id, workspaceId, uploadedByUserId: userId, name: originalFileName, originalFileName, mimeType: file.mimetype, sizeBytes: file.size, storageKey }, include: { uploadedBy: { select: { firstName: true, lastName: true, email: true } } } });
      try { await this.queue.add(document.id, workspaceId); } catch (error) { await this.db.knowledgeDocument.delete({ where: { id: document.id } }); throw error; }
      return publicDocument(document as unknown as Record<string, unknown>);
    } catch (error) { await this.storage.delete(storageKey); throw error; }
  }

  async addUrl(userId: string, workspaceId: string, rawUrl: string): Promise<Record<string, unknown>> {
    await this.requireUploadAccess(userId, workspaceId);
    let url = await assertPublicUrl(rawUrl.trim());
    let response: Response | undefined;
    const visited = new Set<string>();
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      if (visited.has(url.toString())) throw new ConflictException('The website returned a redirect loop');
      visited.add(url.toString());
      response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { Accept: 'text/html,text/plain;q=0.9' } });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location'); if (!location) throw new ConflictException('The website returned an invalid redirect');
      url = await assertPublicUrl(new URL(location, url).toString());
      if (redirect === 5) throw new ConflictException('The website redirected too many times');
    }
    if (!response) throw new ConflictException('The website could not be fetched');
    if (!response.ok) throw new ConflictException('The website could not be fetched');
    const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? 'text/html'; if (!['text/html', 'text/plain'].includes(type)) throw new ConflictException('Only HTML and plain-text website sources are supported'); const declaredSize = Number(response.headers.get('content-length') ?? 0); if (declaredSize > maxFileSize) throw new ConflictException('Website content must be 10 MB or smaller');
    if (!response.body) throw new ConflictException('The website returned an empty response');
    const reader = response.body.getReader(); const chunks: Buffer[] = []; let total = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; if (total > maxFileSize) { await reader.cancel(); throw new ConflictException('Website content must be 10 MB or smaller'); } chunks.push(Buffer.from(next.value)); } } finally { reader.releaseLock(); }
    const buffer = Buffer.concat(chunks); if (buffer.length === 0) throw new ConflictException('Website content must be between 1 byte and 10 MB');
    const name = url.hostname + url.pathname; const duplicate = await this.db.knowledgeDocument.findFirst({ where: { workspaceId, deletedAt: null, originalFileName: url.toString(), status: { not: 'FAILED' } }, select: { id: true, name: true, status: true } }); if (duplicate) throw new ConflictException(`This website source is already in the workspace (${duplicate.name})`);
    await this.billingUsage?.assertCanConsume(workspaceId, 'DOCUMENTS'); await this.billingUsage?.assertCanConsume(workspaceId, 'STORAGE', buffer.length);
    const id = randomUUID(); const storageKey = `knowledge/${workspaceId}/${id}/${safeName(name)}.html`;
    await this.storage.save(storageKey, buffer);
    try { const document = await this.db.knowledgeDocument.create({ data: { id, workspaceId, uploadedByUserId: userId, name, originalFileName: url.toString(), mimeType: type, sizeBytes: buffer.length, storageKey }, include: { uploadedBy: { select: { firstName: true, lastName: true, email: true } } } }); try { await this.queue.add(document.id, workspaceId); } catch (error) { await this.db.knowledgeDocument.delete({ where: { id: document.id } }); throw error; } return publicDocument(document as unknown as Record<string, unknown>); } catch (error) { await this.storage.delete(storageKey); throw error; }
  }

  async list(userId: string, workspaceId: string, query: KnowledgeListQueryDto) {
    await this.access(userId, workspaceId); const page = query.page ?? 1; const pageSize = query.pageSize ?? 20; const search = query.search?.trim();
    const where = { workspaceId, deletedAt: null, ...(query.status ? { status: query.status as DocumentStatus } : {}), ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}) };
    const [total, documents] = await Promise.all([this.db.knowledgeDocument.count({ where }), this.db.knowledgeDocument.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { uploadedBy: { select: { firstName: true, lastName: true, email: true } }, _count: { select: { chunks: true } } } })]);
    const results = await Promise.all(documents.map(async (document) => ({ ...publicDocument(document as unknown as Record<string, unknown>), ...await this.embeddingSummary(document.id, document._count.chunks, document.status) })));
    return { documents: results, page, pageSize, total };
  }

  async detail(userId: string, workspaceId: string, documentId: string) { await this.access(userId, workspaceId); const document = await this.db.knowledgeDocument.findFirst({ where: { id: documentId, workspaceId, deletedAt: null }, include: { uploadedBy: { select: { firstName: true, lastName: true, email: true } }, _count: { select: { chunks: true } } } }); if (!document) throw new NotFoundException('Document not found'); const metadata = publicDocument(document as unknown as Record<string, unknown>); return { ...metadata, extractedText: document.extractedText, ...await this.embeddingSummary(document.id, document._count.chunks, document.status) }; }

  async chunks(userId: string, workspaceId: string, documentId: string, query: KnowledgeChunkQueryDto) { await this.access(userId, workspaceId); const document = await this.db.knowledgeDocument.findFirst({ where: { id: documentId, workspaceId, deletedAt: null }, select: { id: true } }); if (!document) throw new NotFoundException('Document not found'); const page = query.page ?? 1; const limit = query.limit ?? 20; const where = { documentId, workspaceId }; const total = await this.db.knowledgeChunk.count({ where }); const chunks = query.includeContent === 'false' ? await this.db.knowledgeChunk.findMany({ where, orderBy: { chunkIndex: 'asc' }, skip: (page - 1) * limit, take: limit, select: { id: true, chunkIndex: true, characterStart: true, characterEnd: true, tokenCountEstimate: true, createdAt: true } }) : await this.db.knowledgeChunk.findMany({ where, orderBy: { chunkIndex: 'asc' }, skip: (page - 1) * limit, take: limit, select: { id: true, chunkIndex: true, characterStart: true, characterEnd: true, tokenCountEstimate: true, content: true, createdAt: true } }); return { chunks, page, limit, total }; }

  async reprocess(userId: string, workspaceId: string, documentId: string) { await this.requireUploadAccess(userId, workspaceId); const document = await this.db.knowledgeDocument.findFirst({ where: { id: documentId, workspaceId, deletedAt: null }, select: { id: true, workspaceId: true } }); if (!document) throw new NotFoundException('Document not found'); await this.db.knowledgeDocument.update({ where: { id: document.id }, data: { status: 'UPLOADED', processingError: null } }); await this.queue.add(document.id, document.workspaceId); return { id: document.id, status: 'UPLOADED' }; }

  async remove(userId: string, workspaceId: string, documentId: string): Promise<void> { await this.requireDeleteAccess(userId, workspaceId); const document = await this.db.knowledgeDocument.findFirst({ where: { id: documentId, workspaceId, deletedAt: null } }); if (!document) throw new NotFoundException('Document not found'); await this.db.knowledgeDocument.update({ where: { id: document.id }, data: { deletedAt: new Date() } }); await this.storage.delete(document.storageKey); }
}
