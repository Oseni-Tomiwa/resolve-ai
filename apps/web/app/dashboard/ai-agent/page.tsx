'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import { apiRequest } from '../../api-client';

type AgentStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
type Agent = {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  status: AgentStatus;
  isDefault: boolean;
  selectedDocumentCount: number;
  createdAt: string;
  updatedAt: string;
};
type AgentPage = { items: Agent[]; total: number };
type SortMode = 'recent' | 'name' | 'status';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, init);
}

const statusLabel = (status: AgentStatus): string => status === 'ACTIVE' ? 'Published' : status === 'DISABLED' ? 'Disabled' : status === 'ARCHIVED' ? 'Archived' : 'Draft';
const providerLabel = (provider: string): string => provider === 'google' ? 'Google Gemini' : provider === 'anthropic' ? 'Anthropic Claude' : 'OpenAI';
const formatDate = (value: string): string => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'AI';

export default function AiAgent() {
  const { currentWorkspace, organizationRole, workspaceRole, loading: workspaceLoading, error: workspaceError, reload } = useDashboard();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AgentStatus | 'ALL'>('ALL');
  const [model, setModel] = useState('ALL');
  const [sort, setSort] = useState<SortMode>('recent');
  const canManage = organizationRole === 'OWNER' || organizationRole === 'ADMIN' || workspaceRole === 'ADMIN';

  const load = useCallback(async () => {
    if (!currentWorkspace) return;
    setLoading(true);
    setError('');
    try {
      const data = await api<AgentPage>(`/workspaces/${currentWorkspace.id}/ai/agents?page=1&pageSize=50${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`);
      setAgents(data.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load agents.');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, search]);

  useEffect(() => { void load(); }, [load]);

  const models = useMemo(() => Array.from(new Set(agents.map((agent) => agent.model))).sort(), [agents]);
  const visibleAgents = useMemo(() => agents.filter((agent) => (status === 'ALL' || agent.status === status) && (model === 'ALL' || agent.model === model)).sort((left, right) => sort === 'name' ? left.name.localeCompare(right.name) : sort === 'status' ? left.status.localeCompare(right.status) : Number(new Date(right.updatedAt)) - Number(new Date(left.updatedAt))), [agents, model, sort, status]);

  async function updateStatus(agent: Agent, next: 'ACTIVE' | 'DISABLED'): Promise<void> {
    if (!currentWorkspace) return;
    try { await api(`/workspaces/${currentWorkspace.id}/ai/agents/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update this agent.'); }
  }
  async function setDefault(agent: Agent): Promise<void> {
    if (!currentWorkspace) return;
    try { await api(`/workspaces/${currentWorkspace.id}/ai/agents/${agent.id}/set-default`, { method: 'POST', body: '{}' }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to set the default agent.'); }
  }
  async function duplicate(agent: Agent): Promise<void> {
    if (!currentWorkspace) return;
    try { await api(`/workspaces/${currentWorkspace.id}/ai/agents/${agent.id}/duplicate`, { method: 'POST', body: '{}' }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to duplicate this agent.'); }
  }
  async function publish(agent: Agent): Promise<void> {
    if (!currentWorkspace) return;
    try { await api(`/workspaces/${currentWorkspace.id}/ai/agents/${agent.id}/publish`, { method: 'POST', body: '{}' }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to publish this agent.'); }
  }
  async function archive(agent: Agent): Promise<void> {
    if (!currentWorkspace || !window.confirm(`Archive ${agent.name}?`)) return;
    try { await api(`/workspaces/${currentWorkspace.id}/ai/agents/${agent.id}/archive`, { method: 'POST', body: '{}' }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to archive this agent.'); }
  }
  async function remove(agent: Agent): Promise<void> {
    if (!currentWorkspace || !window.confirm(`Delete ${agent.name}? Existing conversations remain readable.`)) return;
    try { await api(`/workspaces/${currentWorkspace.id}/ai/agents/${agent.id}`, { method: 'DELETE' }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to delete this agent.'); }
  }

  if (workspaceLoading) return <section className="agent-page"><p className="dashboard-inline-status" role="status">Loading your workspace…</p></section>;
  if (workspaceError) return <section className="agent-page"><div className="dashboard-error" role="alert"><span>{workspaceError}</span><button type="button" onClick={() => void reload()}>Try again</button></div></section>;

  return <section className="agent-page agent-management-page">
    <div className="agent-management-hero"><div><p className="eyebrow">Workspace AI</p><h2>AI Agent Builder</h2><p>Design, publish, and manage the support agents that represent {currentWorkspace?.name ?? 'your workspace'}.</p></div><div className="agent-hero-actions">{canManage && <Link className="button button-small" href="/dashboard/ai-agent/new">Create agent <span>↗</span></Link>}<Link className="button button-ghost button-small" href="/dashboard/knowledge/ask">Open playground <span>↗</span></Link></div></div>
    <div className="agent-overview-stats"><div><span>Total agents</span><strong>{agents.length}</strong><small>Across this workspace</small></div><div><span>Published</span><strong>{agents.filter((agent) => agent.status === 'ACTIVE').length}</strong><small>Ready for conversations</small></div><div><span>Knowledge scope</span><strong>{agents.reduce((total, agent) => total + agent.selectedDocumentCount, 0)}</strong><small>Selected document links</small></div><div><span>Last updated</span><strong>{agents.length ? formatDate(agents.reduce((latest, agent) => agent.updatedAt > latest ? agent.updatedAt : latest, agents[0]?.updatedAt ?? '')) : '—'}</strong><small>Workspace agents</small></div></div>
    {error && <div className="dashboard-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div>}
    <div className="agent-toolbar"><label className="agent-search"><span className="visually-hidden">Search agents</span><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search agents" /></label><label><span className="visually-hidden">Filter by status</span><select value={status} onChange={(event) => setStatus(event.target.value as AgentStatus | 'ALL')}><option value="ALL">All statuses</option><option value="ACTIVE">Published</option><option value="DRAFT">Draft</option><option value="DISABLED">Disabled</option><option value="ARCHIVED">Archived</option></select></label><label><span className="visually-hidden">Filter by model</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="ALL">All models</option>{models.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span className="visually-hidden">Sort agents</span><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="recent">Recently updated</option><option value="name">Name A–Z</option><option value="status">Status</option></select></label></div>
    {loading ? <div className="agent-card-grid agent-card-skeletons" aria-label="Loading agents"><i /><i /><i /></div> : visibleAgents.length === 0 ? <div className="empty-state agent-empty"><div className="empty-state-icon">✦</div><p className="eyebrow">{agents.length ? 'No matching agents' : 'Workspace agent'}</p><h2>{agents.length ? 'Try another filter.' : 'Create your first AI agent.'}</h2><p className="empty-state-description">{agents.length ? 'Adjust your search or filters to find the agent you need.' : 'Build a grounded support voice with a clear identity, safe behavior, and a helpful point of view.'}</p>{canManage && !agents.length && <Link className="button button-small" href="/dashboard/ai-agent/new">Create your first agent <span>↗</span></Link>}</div> : <div className="agent-card-grid">{visibleAgents.map((agent) => <article className="agent-management-card" key={agent.id}><div className="agent-management-card-top"><div className="agent-avatar-large">{initials(agent.name)}</div><div className="agent-card-heading"><div><h3>{agent.name}</h3><div className="agent-badge-row">{agent.isDefault && <span className="agent-badge default">Default</span>}<span className={`agent-badge ${agent.status.toLowerCase()}`}>{statusLabel(agent.status)}</span><span className="agent-model-badge">{providerLabel(agent.provider)} · {agent.model}</span></div></div><button className="agent-more-button" type="button" aria-label={`Duplicate ${agent.name}`} onClick={() => void duplicate(agent)}>•••</button></div></div><p className="agent-management-description">{agent.description ?? 'A grounded support agent for your workspace.'}</p><div className="agent-management-metrics"><div><strong>{agent.selectedDocumentCount}</strong><span>Knowledge docs</span></div><div><strong>—</strong><span>Conversations</span></div></div><div className="agent-card-dates"><span>Updated <strong>{formatDate(agent.updatedAt)}</strong></span><span>Created <strong>{formatDate(agent.createdAt)}</strong></span></div><div className="agent-management-actions"><Link className="text-link" href={`/dashboard/ai-agent/${agent.id}`}>Edit <span>→</span></Link>{canManage && <><button type="button" onClick={() => void duplicate(agent)}>Duplicate</button>{agent.status === 'DRAFT' && <button type="button" onClick={() => void publish(agent)}>Publish</button>}{agent.status === 'ACTIVE' && <button type="button" onClick={() => void updateStatus(agent, 'DISABLED')} disabled={agent.isDefault}>Disable</button>}{!agent.isDefault && agent.status === 'ACTIVE' && <button type="button" onClick={() => void setDefault(agent)}>Set default</button>}{!agent.isDefault && agent.status !== 'ARCHIVED' && <button type="button" onClick={() => void archive(agent)}>Archive</button>}{!agent.isDefault && <button type="button" onClick={() => void remove(agent)}>Delete</button>}</>}</div></article>)}</div>}
  </section>;
}
