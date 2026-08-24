import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PrismaClient } from '@resolveai/database';
import { AgentsService } from './agents.service';

const agent = { id: 'agent-1', workspaceId: 'workspace-1', createdByUserId: 'user-1', name: 'Support Agent', slug: 'support-agent', description: 'Grounded support', instructions: 'Use the sources.', greeting: 'Hi', fallbackMessage: 'No answer.', provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2, maxOutputTokens: 800, status: 'ACTIVE', isDefault: true, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), deletedAt: null };

function setup() {
  const db = {
    workspace: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-1' }) },
    organizationMember: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
    workspaceMember: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
    aIAgent: { findFirst: jest.fn().mockResolvedValue(agent), create: jest.fn().mockResolvedValue(agent), count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([agent]), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue(agent) },
    $transaction: jest.fn(async (action: unknown) => typeof action === 'function' ? (action as (client: typeof db) => Promise<unknown>)(db) : Promise.all(action as Promise<unknown>[])),
  };
  return { db, service: new AgentsService(db as unknown as PrismaClient, { prepare: jest.fn(), completePrepared: jest.fn() } as never) };
}

describe('AgentsService', () => {
  it('returns the existing workspace default without creating a duplicate', async () => {
    // Arrange
    const { db, service } = setup();
    // Act
    const result = await service.ensureDefault('workspace-1', 'user-1');
    // Assert
    expect(result.id).toBe('agent-1');
    expect(db.aIAgent.create).not.toHaveBeenCalled();
  });

  it('creates the first agent as the workspace default', async () => {
    // Arrange
    const { db, service } = setup();
    db.aIAgent.count.mockResolvedValue(0);
    db.aIAgent.findFirst.mockResolvedValue(null);
    // Act
    await service.create('user-1', 'workspace-1', { name: 'Billing Helper', instructions: 'Answer billing questions.', status: 'ACTIVE' });
    // Assert
    expect(db.aIAgent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isDefault: true, workspaceId: 'workspace-1', model: 'gpt-4o-mini' }) }));
  });

  it('persists the selected provider with its model', async () => {
    // Arrange
    const { db, service } = setup();
    // Act
    await service.create('user-1', 'workspace-1', { name: 'Claude Helper', instructions: 'Use the sources.', provider: 'anthropic', model: 'claude-sonnet-4-6' });
    // Assert
    expect(db.aIAgent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-4-6' }) }));
  });

  it('rejects a viewer from creating an agent', async () => {
    // Arrange
    const { service, db } = setup();
    db.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    db.workspaceMember.findUnique.mockResolvedValue({ role: 'VIEWER' });
    // Act / Assert
    await expect(service.create('user-1', 'workspace-1', { name: 'Blocked', instructions: 'Nope' })).rejects.toThrow(ForbiddenException);
  });

  it('blocks deleting the default agent until another default is chosen', async () => {
    // Arrange
    const { service } = setup();
    // Act / Assert
    await expect(service.remove('user-1', 'workspace-1', 'agent-1')).rejects.toThrow(ConflictException);
  });

  it('clears the previous default inside the set-default transaction', async () => {
    // Arrange
    const { db, service } = setup();
    db.aIAgent.findFirst.mockResolvedValue({ ...agent, id: 'agent-2', isDefault: false });
    // Act
    await service.setDefault('user-1', 'workspace-1', 'agent-2');
    // Assert
    expect(db.aIAgent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'workspace-1', isDefault: true }), data: { isDefault: false } }));
    expect(db.aIAgent.update).toHaveBeenCalledWith({ where: { id: 'agent-2' }, data: { isDefault: true } });
  });
});
