'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboard } from '../dashboard-context';
import { apiRequest } from '../../api-client';

type Agent = { id?: string; name: string; slug: string; description: string | null; instructions: string; greeting: string | null; fallbackMessage: string | null; model: string; temperature: number; topP: number; maxOutputTokens: number; requireCitations: boolean; groundedOnly: boolean; allowFollowUpQuestions: boolean; allowGeneralKnowledge: boolean; status: 'DRAFT' | 'ACTIVE' | 'DISABLED' | 'ARCHIVED'; isDefault: boolean; documentIds: string[] };
type ModelOption = { id: string; label: string };
type Document = { id: string; name: string; originalFileName: string; status: string };
type PlaygroundResult = { answer: string; sources: Array<{ number: number; documentName: string; contentPreview: string; cited: boolean }>; metadata: { model: string | null; retrievalResultCount: number; latencyMs: number; insufficientContext: boolean } };
const emptyAgent: Agent = { name: '', slug: '', description: null, instructions: '', greeting: null, fallbackMessage: null, model: 'gpt-4o-mini', temperature: 0.2, topP: 1, maxOutputTokens: 800, requireCitations: true, groundedOnly: true, allowFollowUpQuestions: true, allowGeneralKnowledge: false, status: 'DRAFT', isDefault: false, documentIds: [] };

function humanizeDocumentName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> { return apiRequest<T>(path, init); }

export function AgentEditor({ agentId }: { agentId?: string }) {
  const router = useRouter();
  const { currentWorkspace, organizationRole, workspaceRole, loading: workspaceLoading } = useDashboard();
  const [agent, setAgent] = useState<Agent>(emptyAgent);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [question, setQuestion] = useState('');
  const [playground, setPlayground] = useState<PlaygroundResult | null>(null);
  const [loading, setLoading] = useState(Boolean(agentId));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const canManage = organizationRole === 'OWNER' || organizationRole === 'ADMIN' || workspaceRole === 'ADMIN';

  useEffect(() => {
    if (!currentWorkspace) return;
    void Promise.all([
      api<{ items: ModelOption[] }>(`/workspaces/${currentWorkspace.id}/ai/agents/models`),
      api<Document[]>(`/workspaces/${currentWorkspace.id}/ai/agents/knowledge-documents`),
    ]).then(([modelData, documentData]) => { setModels(modelData.items); setDocuments(documentData.map((document) => ({ ...document, name: humanizeDocumentName(document.name), originalFileName: humanizeDocumentName(document.originalFileName) }))); }).catch(() => setModels([{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }]));
    if (agentId) void api<Agent>(`/workspaces/${currentWorkspace.id}/ai/agents/${agentId}`).then(setAgent).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load the agent.')).finally(() => setLoading(false));
  }, [agentId, currentWorkspace]);
  useEffect(() => { const handle = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', handle); return () => window.removeEventListener('beforeunload', handle); }, [dirty]);

  function update<K extends keyof Agent>(key: K, value: Agent[K]): void { setAgent((current) => ({ ...current, [key]: value })); setDirty(true); setSaved(false); }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!currentWorkspace || !agent.name.trim() || !agent.instructions.trim()) { setError('Name and instructions are required.'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...agent, id: undefined, slug: agent.slug.trim() || undefined, status: 'DRAFT' as const };
      const data = agentId ? await api<Agent>(`/workspaces/${currentWorkspace.id}/ai/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify(payload) }) : await api<Agent>(`/workspaces/${currentWorkspace.id}/ai/agents`, { method: 'POST', body: JSON.stringify({ ...payload, isDefault: false }) });
      setAgent((current) => ({ ...current, ...data })); setDirty(false); setSaved(true); if (!agentId && data.id) router.replace(`/dashboard/ai-agent/${data.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save the agent.'); } finally { setSaving(false); }
  }
  async function publish(): Promise<void> {
    if (!currentWorkspace || !agent.id) return;
    setSaving(true); setError('');
    try { const data = await api<Agent>(`/workspaces/${currentWorkspace.id}/ai/agents/${agent.id}/publish`, { method: 'POST', body: '{}' }); setAgent((current) => ({ ...current, ...data, status: 'ACTIVE' })); setDirty(false); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to publish the agent.'); } finally { setSaving(false); }
  }
  async function playgroundTest(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!currentWorkspace || !agent.id || !question.trim()) return;
    setTesting(true); setError('');
    try { setPlayground(await api<PlaygroundResult>(`/workspaces/${currentWorkspace.id}/ai/agents/${agent.id}/playground`, { method: 'POST', body: JSON.stringify({ question }) })); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to test this draft.'); } finally { setTesting(false); }
  }

  if (workspaceLoading || loading) return <section className="agent-page"><p className="dashboard-inline-status" role="status">Loading agent configuration…</p></section>;
  if (!canManage) return <section className="agent-page"><div className="dashboard-error" role="alert">You do not have permission to edit workspace agents.</div></section>;

  return <section className="agent-page agent-studio-page">
    <div className="agent-heading agent-studio-heading"><div><Link className="text-link" href="/dashboard/ai-agent">← All agents</Link><p className="eyebrow">Agent configuration studio</p><h2>{agentId ? agent.name || 'Edit agent' : 'Create an agent'}</h2><p>Shape a grounded support voice with clear behavior, safe defaults, and a live preview.</p></div><span className={`agent-badge ${agent.status.toLowerCase()}`}>{agent.status === 'ACTIVE' ? 'Published' : agent.status === 'DISABLED' ? 'Disabled' : 'Draft'}</span></div>
    {error && <div className="dashboard-error" role="alert">{error}</div>}
    <form className="agent-editor" onSubmit={(event) => void submit(event)}>
      <div className="agent-editor-layout"><div className="agent-editor-fields">
        <section className="agent-editor-section"><div className="section-heading"><div><p className="eyebrow">Identity</p><h3>Give your agent a clear point of view</h3></div><span className="section-hint">Required</span></div><div className="agent-identity-row"><div className="agent-avatar-large">{agent.name.trim().slice(0, 2).toUpperCase() || 'AI'}</div><div><strong>{agent.name || 'Your agent'}</strong><p>Shown to teammates and customers when this agent responds.</p></div></div><div className="agent-form-grid"><label>Name<input value={agent.name} onChange={(event) => update('name', event.target.value)} maxLength={80} required placeholder="ResolveAI Support Agent" /></label><label>Slug<input value={agent.slug} onChange={(event) => update('slug', event.target.value)} maxLength={80} placeholder="support-agent" /></label><label className="agent-wide">Description<textarea value={agent.description ?? ''} onChange={(event) => update('description', event.target.value || null)} maxLength={500} rows={2} placeholder="Answers questions from the workspace knowledge base." /></label></div></section>
        <section className="agent-editor-section"><div className="section-heading"><div><p className="eyebrow">Behavior</p><h3>Make every response feel intentional</h3></div></div><div className="agent-form-grid"><label className="agent-wide">Instructions<textarea value={agent.instructions} onChange={(event) => update('instructions', event.target.value)} maxLength={4000} rows={7} required placeholder="Describe the agent's tone and behavior." /><small>Instructions are bounded by ResolveAI grounding and safety rules.</small></label><label>Greeting<textarea value={agent.greeting ?? ''} onChange={(event) => update('greeting', event.target.value || null)} maxLength={300} rows={3} placeholder="Hi! How can I help you today?" /></label><label>Fallback message<textarea value={agent.fallbackMessage ?? ''} onChange={(event) => update('fallbackMessage', event.target.value || null)} maxLength={500} rows={3} placeholder="I couldn't find enough information…" /></label></div></section>
        <section className="agent-editor-section"><div className="section-heading"><div><p className="eyebrow">Knowledge</p><h3>Connect the right support context</h3></div><span className="section-hint">{agent.documentIds.length} selected</span></div><p>Select READY documents. Empty selection uses all READY documents in this workspace.</p><div className="agent-document-actions"><button type="button" onClick={() => update('documentIds', documents.map((document) => document.id))}>Select all</button><button type="button" onClick={() => update('documentIds', [])}>Clear selection</button></div>{documents.length === 0 ? <p className="dashboard-inline-status">No READY documents are available.</p> : <div className="agent-document-list">{documents.map((document) => <label key={document.id}><input type="checkbox" checked={agent.documentIds.includes(document.id)} onChange={(event) => update('documentIds', event.target.checked ? [...agent.documentIds, document.id] : agent.documentIds.filter((id) => id !== document.id))} /> <span>{document.name}<small>{document.originalFileName} · {document.status}</small></span></label>)}</div>}</section>
        <section className="agent-editor-section"><div className="section-heading"><div><p className="eyebrow">Model & safety</p><h3>Keep the agent predictable</h3></div></div><div className="agent-form-grid"><label>Model<select value={agent.model} onChange={(event) => update('model', event.target.value)}>{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select><small>Only approved server-side models are available.</small></label><label>Temperature <output>{agent.temperature.toFixed(2)}</output><input type="range" min="0" max="1" step="0.05" value={agent.temperature} onChange={(event) => update('temperature', Number(event.target.value))} /></label><label>Top P <output>{agent.topP.toFixed(2)}</output><input type="range" min="0" max="1" step="0.05" value={agent.topP} onChange={(event) => update('topP', Number(event.target.value))} /></label><label>Maximum output tokens<input type="number" min={128} max={2000} value={agent.maxOutputTokens} onChange={(event) => update('maxOutputTokens', Number(event.target.value))} /></label><label className="agent-checkbox"><input type="checkbox" checked={agent.groundedOnly} onChange={(event) => update('groundedOnly', event.target.checked)} /> Grounded answers only</label><label className="agent-checkbox"><input type="checkbox" checked={agent.requireCitations} onChange={(event) => update('requireCitations', event.target.checked)} /> Require citations</label><label className="agent-checkbox"><input type="checkbox" checked={agent.allowFollowUpQuestions} onChange={(event) => update('allowFollowUpQuestions', event.target.checked)} /> Allow follow-up questions</label><label className="agent-checkbox"><input type="checkbox" checked={agent.allowGeneralKnowledge} onChange={(event) => update('allowGeneralKnowledge', event.target.checked)} /> Allow general knowledge</label></div><div className="agent-capability-grid"><label className="agent-toggle-card is-disabled"><input type="checkbox" disabled /> <span><strong>Web search <em>Future</em></strong><small>Live web search is not available yet.</small></span></label><label className="agent-toggle-card is-disabled"><input type="checkbox" disabled /> <span><strong>Memory <em>Future</em></strong><small>Conversation memory is managed by the workspace.</small></span></label></div></section>
      </div><aside className="agent-preview"><div className="section-heading"><div><p className="eyebrow">Live preview</p><h3>How it will feel</h3></div><span className="agent-preview-live">● Live</span></div><div className="agent-preview-window"><div className="agent-preview-avatar">{agent.name.trim().slice(0, 2).toUpperCase() || 'AI'}</div><div className="agent-preview-bubble"><strong>{agent.name || 'Your agent'}</strong><p>{agent.greeting || 'Your greeting will appear here.'}</p></div><div className="agent-preview-message">{agent.instructions ? 'Ask a question to see a grounded response.' : 'Your first AI response will appear here.'}<span className="typing-dots"><i /><i /><i /></span></div></div><div className="agent-preview-details"><span>Status <strong>{agent.status === 'ACTIVE' ? 'Published' : 'Draft'}</strong></span><span>Model <strong>{agent.model}</strong></span><span>Knowledge <strong>{agent.documentIds.length || 'All READY'}</strong></span></div><small>Preview is local until you test a saved draft.</small></aside></div>
      <div className="agent-form-actions"><Link className="button button-ghost" href="/dashboard/ai-agent">Cancel</Link><button className="button button-ghost" type="button" onClick={() => document.querySelector('.agent-preview')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Preview</button><button className="button button-small" type="submit" disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved draft' : 'Save draft'} <span>↗</span></button><button className="button button-publish" type="button" disabled={saving || !agent.id || agent.status === 'ACTIVE'} onClick={() => void publish()}>{saving ? 'Publishing…' : 'Publish agent'} <span>↗</span></button></div>
    </form>
    {agent.id && <section className="agent-playground"><div className="section-heading"><div><p className="eyebrow">Draft playground</p><h3>Test before publishing</h3></div><span className="section-hint">No customer conversation is created</span></div><form className="knowledge-search-row" onSubmit={(event) => void playgroundTest(event)}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask this draft a question…" maxLength={1000} /><button className="button button-small" disabled={testing || !question.trim()}>{testing ? 'Testing…' : 'Test draft'}</button></form>{playground && <div className="knowledge-answer-results"><p>{playground.answer}</p>{playground.sources.map((source) => <div className="knowledge-answer-source" key={source.number}><strong>[{source.number}] {source.documentName}</strong><small>{source.contentPreview}</small></div>)}<small>Model: {playground.metadata.model ?? 'none'} · Retrieved: {playground.metadata.retrievalResultCount} · {playground.metadata.latencyMs}ms{playground.metadata.insufficientContext ? ' · insufficient context' : ''}</small></div>}</section>}
  </section>;
}
