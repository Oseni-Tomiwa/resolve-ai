import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WidgetService } from './widget.service';

const agent = { id: 'agent-1', name: 'Support Agent', description: 'Helpful', greeting: 'Hello', instructions: 'Use sources.', fallbackMessage: 'No answer.', model: 'gpt-4o-mini', temperature: 0.2, maxOutputTokens: 800, status: 'ACTIVE', deletedAt: null };
const configuration = { id: 'config-1', workspaceId: 'workspace-1', publicId: 'widget_public', enabled: true, name: 'Support', greeting: 'Welcome', accentColor: '#7ce7dc', position: 'BOTTOM_RIGHT', launcherLabel: 'Chat', allowedDomains: ['https://docs.example.com'], selectedAgentId: 'agent-1', selectedAgent: agent };

function makeService() {
  const db = { widgetConfiguration: { findUnique: jest.fn().mockResolvedValue(configuration), upsert: jest.fn(), update: jest.fn() }, widgetSession: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() }, widgetConversation: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, widgetMessage: { create: jest.fn() }, aIAgent: { findMany: jest.fn().mockResolvedValue([agent]), findFirst: jest.fn().mockResolvedValue({ id: agent.id }) } };
  return { service: new WidgetService(db as never, {} as never), db };
}

describe('WidgetService', () => {
  it('returns only safe public configuration fields', async () => {
    const { service } = makeService();
    const result = await service.publicConfig('widget_public', { headers: { origin: 'https://docs.example.com' } });
    expect(result).toEqual(expect.objectContaining({ publicId: 'widget_public', name: 'Support', agent: { name: 'Support Agent', description: 'Helpful', greeting: 'Hello' } }));
    expect(result).not.toHaveProperty('workspaceId');
    expect(result).not.toHaveProperty('selectedAgentId');
    expect(result).not.toHaveProperty('agent.instructions');
  });

  it('rejects an unauthorized widget origin', async () => {
    const { service } = makeService();
    await expect(service.publicConfig('widget_public', { headers: { origin: 'https://evil.example.com' } })).rejects.toThrow(ForbiddenException);
  });

  it('normalizes an allowed origin without accepting a different port or deceptive subdomain', async () => {
    // Arrange
    const { service } = makeService();

    // Act / Assert
    await expect(service.publicConfig('widget_public', { headers: { origin: 'https://docs.example.com/' } })).resolves.toEqual(expect.objectContaining({ publicId: 'widget_public' }));
    await expect(service.publicConfig('widget_public', { headers: { origin: 'https://docs.example.com:444' } })).rejects.toThrow(ForbiddenException);
    await expect(service.publicConfig('widget_public', { headers: { origin: 'https://evil-docs.example.com' } })).rejects.toThrow(ForbiddenException);
    await expect(service.publicConfig('widget_public', { headers: {} })).rejects.toThrow(ForbiddenException);
  });

  it('allows localhost without an allowlist only outside production', async () => {
    // Arrange
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const { service, db } = makeService();
    db.widgetConfiguration.findUnique.mockResolvedValue({ ...configuration, allowedDomains: [] });

    // Act / Assert
    await expect(service.publicConfig('widget_public', { headers: { origin: 'http://localhost:3000/' } })).resolves.toEqual(expect.objectContaining({ publicId: 'widget_public' }));
    process.env.NODE_ENV = previous;
  });

  it('returns a safe disabled response but blocks session creation', async () => {
    // Arrange
    const { service, db } = makeService();
    db.widgetConfiguration.findUnique.mockResolvedValue({ ...configuration, enabled: false });

    // Act / Assert
    await expect(service.publicConfig('widget_public', { headers: { origin: 'https://docs.example.com' } })).resolves.toEqual(expect.objectContaining({ enabled: false }));
    await expect(service.createSession('widget_public', {}, { headers: { origin: 'https://docs.example.com' } })).rejects.toThrow('currently unavailable');
  });

  it('rejects a missing widget without leaking workspace details', async () => {
    const { service, db } = makeService();
    db.widgetConfiguration.findUnique.mockResolvedValue(null);
    await expect(service.publicConfig('unknown', { headers: {} })).rejects.toThrow(NotFoundException);
  });

  it('does not create a second session when an opaque session token is valid for the same widget', async () => {
    const { service, db } = makeService();
    db.widgetSession.findFirst.mockResolvedValue({ id: 'session-1', expiresAt: new Date(Date.now() + 60_000) });
    const result = await service.createSession('widget_public', { sessionId: 'opaque-session-token-1234567890' }, { headers: { origin: 'https://docs.example.com' } });
    expect(result.sessionId).toBe('opaque-session-token-1234567890');
    expect(db.widgetSession.create).not.toHaveBeenCalled();
  });

  it('moves a scoped visitor conversation to human support without exposing private notes', async () => {
    // Arrange
    const { service, db } = makeService();
    db.widgetSession.findFirst.mockResolvedValue({ id: 'session-1', expiresAt: new Date(Date.now() + 60_000), messageCount: 0 });
    db.widgetConversation.findFirst.mockResolvedValue({ id: 'conversation-1', mode: 'AI', status: 'OPEN' });
    db.widgetConversation.update.mockResolvedValue({ id: 'conversation-1', mode: 'HUMAN', status: 'OPEN' });

    // Act
    const result = await service.requestHuman('widget_public', 'conversation-1', 'opaque-session-token-1234567890', { headers: { origin: 'https://docs.example.com' } });

    // Assert
    expect(result).toEqual({ mode: 'HUMAN', status: 'OPEN' });
    expect(db.widgetConversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ mode: 'AI', workspaceId: 'workspace-1' }), data: expect.objectContaining({ mode: 'HUMAN', status: 'OPEN', generationLockAt: null }) }));
    expect(db.widgetMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'SYSTEM', content: 'A visitor requested a support teammate.' }) }));
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
