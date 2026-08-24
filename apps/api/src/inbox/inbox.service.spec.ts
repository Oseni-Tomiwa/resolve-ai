import { ConflictException } from '@nestjs/common';
import { InboxService } from './inbox.service';

function makeService() {
  const conversation = { id: 'conversation-1', workspaceId: 'workspace-1', mode: 'AI', status: 'OPEN' };
  const db = {
    widgetConversation: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue(conversation),
      findFirst: jest.fn().mockResolvedValue(conversation),
      findMany: jest.fn().mockResolvedValue([]),
    },
    widgetMessage: { create: jest.fn().mockResolvedValue({ id: 'message-1' }), findFirst: jest.fn().mockResolvedValue(null) },
    widgetConversationNote: { create: jest.fn().mockResolvedValue({ id: 'note-1', content: 'Private note' }) },
    widgetConversationRead: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
  };
  const access = { getAccess: jest.fn().mockResolvedValue({ organizationRole: 'MEMBER', workspaceRole: 'AGENT' }) };
  return { service: new InboxService(db as never, access as never), db, access };
}

describe('InboxService', () => {
  it('returns an empty workspace-scoped inbox without treating it as missing', async () => {
    // Arrange
    const { service, db, access } = makeService();
    db.widgetConversation.findMany = jest.fn().mockResolvedValue([]);
    db.widgetConversationRead.findMany.mockResolvedValue([]);
    access.getAccess.mockResolvedValue({ organizationRole: 'OWNER', workspaceRole: '' });

    // Act
    const result = await service.list('owner-1', 'workspace-1', {});

    // Assert
    expect(result).toEqual({ items: [], unreadCount: 0, canManage: true });
    expect(db.widgetConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'workspace-1' } }));
  });

  it('denies an inbox list when workspace access is rejected', async () => {
    // Arrange
    const { service, access } = makeService();
    access.getAccess.mockRejectedValue(new Error('Workspace membership required'));

    // Act
    const action = service.list('outsider-1', 'workspace-1', {});

    // Assert
    await expect(action).rejects.toThrow('Workspace membership required');
  });

  it('takes an AI conversation over atomically and assigns it to the teammate', async () => {
    const { service, db } = makeService();
    db.widgetConversation.findFirst.mockResolvedValue({ id: 'conversation-1', workspaceId: 'workspace-1', status: 'OPEN', mode: 'HUMAN', priority: 'NORMAL', source: 'WIDGET', visitorPageUrl: null, visitorReferrer: null, messages: [], notes: [], assignedUser: null, agentNameSnapshot: 'Agent', createdAt: new Date(), lastMessageAt: new Date(), resolvedAt: null });
    await service.takeover('user-1', 'workspace-1', 'conversation-1');
    expect(db.widgetConversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ mode: 'AI', workspaceId: 'workspace-1' }) }));
    expect(db.widgetMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'SYSTEM' }) }));
  });

  it('rejects a takeover when another teammate already won the race', async () => {
    const { service, db } = makeService();
    db.widgetConversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.takeover('user-1', 'workspace-1', 'conversation-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps internal notes separate from public widget messages', async () => {
    const { service, db } = makeService();
    await service.note('user-1', 'workspace-1', 'conversation-1', { content: 'Private note' });
    expect(db.widgetConversationNote.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ authorUserId: 'user-1', content: 'Private note' }) }));
    expect(db.widgetMessage.create).not.toHaveBeenCalled();
  });

  it('requires human mode before sending a teammate reply', async () => {
    const { service, db } = makeService();
    db.widgetConversation.findFirst.mockResolvedValue({ id: 'conversation-1', workspaceId: 'workspace-1', mode: 'AI', status: 'OPEN' });
    db.widgetConversation.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reply('user-1', 'workspace-1', 'conversation-1', { content: 'We can help.' })).rejects.toThrow('Take over the conversation before replying');
  });
});
