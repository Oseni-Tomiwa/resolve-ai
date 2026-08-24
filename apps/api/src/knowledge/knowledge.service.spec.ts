import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { KnowledgeQueueService } from './knowledge-queue.service';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34' }]) }));
jest.mock('@resolveai/storage', () => ({ createStorageFromEnv: jest.fn().mockReturnValue({ save: jest.fn(), delete: jest.fn() }), LocalStorage: jest.fn() }));

// The custom Jest transform does not hoist ES-module mocks, so this test loads the service after registering mocks.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
const { KnowledgeService } = require('./knowledge.service') as { KnowledgeService: typeof import('./knowledge.service').KnowledgeService };

type Db = {
  workspace: { findUnique: jest.Mock };
  organizationMember: { findUnique: jest.Mock };
  workspaceMember: { findUnique: jest.Mock };
  knowledgeDocument: { create: jest.Mock; delete: jest.Mock; count: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  knowledgeChunk: { count: jest.Mock; findMany: jest.Mock };
  knowledgeEmbedding: { count: jest.Mock; findFirst: jest.Mock };
};
function db(): Db { const value: Db = { workspace: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-1' }) }, organizationMember: { findUnique: jest.fn().mockResolvedValue({ role: 'OWNER' }) }, workspaceMember: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) }, knowledgeDocument: { create: jest.fn(), delete: jest.fn(), count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() }, knowledgeChunk: { count: jest.fn(), findMany: jest.fn() }, knowledgeEmbedding: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) } }; return value; }
const file = (overrides: Partial<{ mimetype: string; size: number; originalname: string; buffer: Buffer }> = {}) => ({ mimetype: 'text/plain', size: 12, originalname: 'guide.txt', buffer: Buffer.from('hello'), ...overrides });

describe('KnowledgeService', () => {
  it('uploads an authorized document and queues only safe identifiers', async () => {
    // Arrange
    const database = db(); database.knowledgeDocument.create.mockResolvedValue({ id: 'doc-1', storageKey: 'knowledge/workspace-1/doc-1/guide.txt', name: 'guide.txt', originalFileName: 'guide.txt', mimeType: 'text/plain', sizeBytes: 12, status: 'UPLOADED', uploadedBy: { firstName: 'A', lastName: 'User', email: 'a@example.com' } }); const queue = { add: jest.fn().mockResolvedValue(undefined) } as unknown as KnowledgeQueueService; const service = new KnowledgeService(database as never, queue);
    // Act
    const result = await service.upload('user-1', 'workspace-1', file());
    // Assert
    expect(result).not.toHaveProperty('storageKey'); expect(queue.add).toHaveBeenCalledWith('doc-1', 'workspace-1');
  });

  it('rejects viewers, unsupported MIME types, oversized files, and empty files', async () => {
    // Arrange
    const database = db(); const queue = { add: jest.fn() } as unknown as KnowledgeQueueService; const service = new KnowledgeService(database as never, queue);
    database.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' }); database.workspaceMember.findUnique.mockResolvedValue({ role: 'VIEWER' });
    // Act and assert
    await expect(service.upload('user-1', 'workspace-1', file())).rejects.toThrow(ForbiddenException);
    database.workspaceMember.findUnique.mockResolvedValue({ role: 'AGENT' }); await expect(service.upload('user-1', 'workspace-1', file({ mimetype: 'application/zip' }))).rejects.toThrow(ConflictException); await expect(service.upload('user-1', 'workspace-1', file({ size: 11 * 1024 * 1024 }))).rejects.toThrow(ConflictException); await expect(service.upload('user-1', 'workspace-1', file({ size: 0, buffer: Buffer.alloc(0) }))).rejects.toThrow(ConflictException);
  });

  it('rejects an active duplicate file before writing storage', async () => {
    // Arrange
    const database = db(); database.knowledgeDocument.findFirst.mockResolvedValue({ id: 'existing', name: 'guide.txt', status: 'READY' }); const service = new KnowledgeService(database as never, { add: jest.fn() } as unknown as KnowledgeQueueService);
    // Act / Assert
    await expect(service.upload('user-1', 'workspace-1', file())).rejects.toThrow('already in the workspace');
    expect(database.knowledgeDocument.create).not.toHaveBeenCalled();
  });

  it('rejects local website sources to prevent SSRF', async () => {
    // Arrange
    const database = db(); const service = new KnowledgeService(database as never, { add: jest.fn() } as unknown as KnowledgeQueueService);
    // Act / Assert
    await expect(service.addUrl('user-1', 'workspace-1', 'http://127.0.0.1:4000/private')).rejects.toThrow(ConflictException);
  });

  it('streams website bodies and rejects an oversized response without Content-Length', async () => {
    const database = db(); const service = new KnowledgeService(database as never, { add: jest.fn() } as unknown as KnowledgeQueueService);
    global.fetch = jest.fn().mockResolvedValue(new Response(Buffer.alloc(10 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/plain' } }));
    await expect(service.addUrl('user-1', 'workspace-1', 'https://example.com/large')).rejects.toThrow('10 MB or smaller');
  });

  it('limits redirects and revalidates each destination', async () => {
    const database = db(); const service = new KnowledgeService(database as never, { add: jest.fn() } as unknown as KnowledgeQueueService);
    global.fetch = jest.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { location: `https://example.com/redirect-${(global.fetch as jest.Mock).mock.calls.length}` } }));
    await expect(service.addUrl('user-1', 'workspace-1', 'https://example.com/start')).rejects.toThrow('too many times');
  });

  it('accepts a bounded public website response', async () => {
    const database = db(); database.knowledgeDocument.create.mockResolvedValue({ id: 'doc-url', storageKey: 'knowledge/workspace-1/doc-url/example.com.html', name: 'example.com/', originalFileName: 'https://example.com/', mimeType: 'text/plain', sizeBytes: 5, status: 'UPLOADED', uploadedBy: null });
    const queue = { add: jest.fn().mockResolvedValue(undefined) } as unknown as KnowledgeQueueService; const service = new KnowledgeService(database as never, queue);
    global.fetch = jest.fn().mockResolvedValue(new Response('hello', { headers: { 'content-type': 'text/plain', 'content-length': '5' } }));
    await expect(service.addUrl('user-1', 'workspace-1', 'https://example.com/')).resolves.toEqual(expect.objectContaining({ id: 'doc-url' }));
    expect(queue.add).toHaveBeenCalledWith('doc-url', 'workspace-1');
  });

  it('lists only the current workspace with pagination and search filters', async () => {
    // Arrange
    const database = db(); database.knowledgeDocument.count.mockResolvedValue(1); database.knowledgeDocument.findMany.mockResolvedValue([]); const service = new KnowledgeService(database as never, { add: jest.fn() } as unknown as KnowledgeQueueService);
    // Act
    const result = await service.list('user-1', 'workspace-1', { page: 2, pageSize: 10, search: 'FAQ', status: 'READY' });
    // Assert
    expect(result).toEqual({ documents: [], page: 2, pageSize: 10, total: 1 }); expect(database.knowledgeDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10, where: expect.objectContaining({ workspaceId: 'workspace-1', name: { contains: 'FAQ', mode: 'insensitive' }, status: 'READY' }) }));
  });

  it('rejects cross-workspace detail access and viewer deletion', async () => {
    // Arrange
    const database = db(); database.workspace.findUnique.mockResolvedValue(null); const service = new KnowledgeService(database as never, { add: jest.fn() } as unknown as KnowledgeQueueService);
    // Act and assert
    await expect(service.detail('user-1', 'other-workspace', 'doc-1')).rejects.toThrow(new NotFoundException('Workspace not found'));
    database.workspace.findUnique.mockResolvedValue({ organizationId: 'org-1' }); database.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' }); database.workspaceMember.findUnique.mockResolvedValue({ role: 'VIEWER' }); await expect(service.remove('user-1', 'workspace-1', 'doc-1')).rejects.toThrow(ForbiddenException);
  });

  it('paginates chunks in ascending chunk order without crossing tenants', async () => {
    // Arrange
    const database = db(); database.knowledgeDocument.findFirst.mockResolvedValue({ id: 'doc-1' }); database.knowledgeChunk.count.mockResolvedValue(21); database.knowledgeChunk.findMany.mockResolvedValue([{ id: 'chunk-1', chunkIndex: 10, content: 'content' }]); const service = new KnowledgeService(database as never, { add: jest.fn() } as unknown as KnowledgeQueueService);
    // Act
    const result = await service.chunks('user-1', 'workspace-1', 'doc-1', { page: 2, limit: 10, includeContent: 'true' });
    // Assert
    expect(result).toEqual({ chunks: [{ id: 'chunk-1', chunkIndex: 10, content: 'content' }], page: 2, limit: 10, total: 21 }); expect(database.knowledgeChunk.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { documentId: 'doc-1', workspaceId: 'workspace-1' }, orderBy: { chunkIndex: 'asc' }, skip: 10, take: 10 }));
  });

  it('does not let a viewer reprocess a document', async () => {
    // Arrange
    const database = db(); database.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' }); database.workspaceMember.findUnique.mockResolvedValue({ role: 'VIEWER' }); const service = new KnowledgeService(database as never, { add: jest.fn() } as unknown as KnowledgeQueueService);
    // Act / Assert
    await expect(service.reprocess('user-1', 'workspace-1', 'doc-1')).rejects.toThrow(ForbiddenException);
  });
});
