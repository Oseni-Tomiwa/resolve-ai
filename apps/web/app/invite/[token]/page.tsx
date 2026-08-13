'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth-provider';
import { apiRequest } from '../../api-client';
import { ResolveAILogo } from '../../resolveai-logo';

type Invitation = { email: string; role: string; expiresAt: string; organization: { name: string }; workspace: { name: string }; inviterName: string };
async function request<T>(path: string, init?: RequestInit): Promise<T> { return apiRequest<T>(path, init); }
export default function InvitationPage() {
  const params = useParams<{ token: string }>(); const router = useRouter(); const { user, loading } = useAuth(); const [invitation, setInvitation] = useState<Invitation | null>(null); const [error, setError] = useState(''); const [accepting, setAccepting] = useState(false);
  useEffect(() => { const token = params.token; if (token) void request<Invitation>(`/workspace-invitations/validate?token=${encodeURIComponent(token)}`).then(setInvitation).catch((caught) => setError(caught instanceof Error ? caught.message : 'This invitation is unavailable.')); }, [params.token]);
  async function accept(): Promise<void> { setAccepting(true); try { await request(`/workspace-invitations/accept`, { method: 'POST', body: JSON.stringify({ token: params.token }) }); router.replace('/dashboard'); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to accept invitation.'); } finally { setAccepting(false); } }
  const encoded = encodeURIComponent(params.token); return <div className="auth-layout"><div className="auth-brand-row"><Link className="brand" href="/"><ResolveAILogo size="sm" decorative /><span>resolve<span className="brand-accent">ai</span></span></Link><Link className="back-link" href="/">← Back to home</Link></div><main className="auth-card invitation-card">{error ? <><p className="eyebrow">Invitation unavailable</p><h1>This link can’t be used</h1><p className="invitation-copy">{error}</p><Link className="button auth-submit" href="/">Return home</Link></> : !invitation ? <p className="auth-loading">Checking invitation…</p> : <><p className="eyebrow">You’re invited</p><h1>Join {invitation.workspace.name}</h1><p className="invitation-copy"><strong>{invitation.inviterName}</strong> invited <strong>{invitation.email}</strong> to the <strong>{invitation.organization.name}</strong> organization as a <strong>{invitation.role}</strong>. This invitation expires {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(invitation.expiresAt))}.</p>{loading ? <p className="auth-loading">Checking your session…</p> : user ? user.email.trim().toLowerCase() === invitation.email ? <button className="button auth-submit" type="button" disabled={accepting} onClick={() => void accept()}>{accepting ? 'Joining…' : 'Accept invitation ↗'}</button> : <p className="form-error" role="alert">Sign in with {invitation.email} to accept this invitation.</p> : <div className="invitation-actions"><Link className="button" href={`/login?invitation=${encoded}`}>Sign in to accept</Link><Link className="text-link" href={`/register?invitation=${encoded}`}>New to ResolveAI? Create an account <span>↗</span></Link></div>}</>}</main></div>;
}
