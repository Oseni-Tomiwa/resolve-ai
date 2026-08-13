'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../auth-provider';
import { useDashboard } from './dashboard-context';
import { ResolveAILogo } from '../resolveai-logo';

type IconName = 'overview' | 'inbox' | 'conversations' | 'knowledge' | 'agent' | 'team' | 'settings' | 'billing' | 'widget' | 'menu' | 'chevron' | 'logout';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    overview: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    inbox: 'M4 5h16v14H4zM4 8h16M8 5v3M16 5v3',
    conversations: 'M5 5h14v10H9l-4 4zM8 9h8M8 12h5',
    knowledge: 'M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 0-4 0zM9 20V8a4 4 0 0 1 4-4',
    agent: 'M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7zM18 16l.7 2.3L21 19l-2.3.7L18 22l-.7-2.3L15 19l2.3-.7z',
    team: 'M16 20v-1.5a3.5 3.5 0 0 0-7 0V20M12.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 8a2.5 2.5 0 0 1 0 4M20 19v-1a3 3 0 0 0-2-2.8',
    settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.3 3h-4.6l-.4 2.6a7 7 0 0 0-2 1.2L5 5.9 3 9.3l2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.6l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
    billing: 'M4 6h16v12H4zM4 10h16M8 15h3',
    widget: 'M5 5h14v14H5zM9 9h6v6H9z',
    menu: 'M4 7h16M4 12h16M4 17h16',
    chevron: 'M6 9l6 6 6-6',
    logout: 'M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-4',
  };
  return <svg aria-hidden="true" className="shell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

const primary = [
  ['Overview', '/dashboard', 'overview'], ['Analytics', '/dashboard/analytics', 'overview'], ['Inbox', '/dashboard/inbox', 'inbox'], ['Conversations', '/dashboard/conversations', 'conversations'], ['Knowledge Base', '/dashboard/knowledge', 'knowledge'], ['Ask ResolveAI', '/dashboard/knowledge/ask', 'knowledge'], ['AI Agent', '/dashboard/ai-agent', 'agent'],
] as const;
const workspaceLinks = [['Team', '/dashboard/team', 'team'], ['Widget', '/dashboard/widget', 'widget'], ['Settings', '/dashboard/settings', 'settings'], ['Billing', '/dashboard/billing', 'billing']] as const;

function Switcher({ label, value, options, onChange }: { label: string; value: string; options: Array<{ id: string; name: string; slug: string }>; onChange: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  return <div className="switcher"><button type="button" className="switcher-trigger" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((current) => !current)}><span className="switcher-label">{label}</span><strong>{value || 'Select'}</strong><Icon name="chevron" /></button>{open && <div className="switcher-menu" role="listbox" aria-label={`Select ${label.toLowerCase()}`}>{options.map((option) => <button type="button" role="option" aria-selected={option.name === value} key={option.id} onClick={() => { void onChange(option.id).finally(() => setOpen(false)); }}>{option.name}</button>)}</div>}</div>;
}

function Sidebar({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle: () => void; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <aside className={`dashboard-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="Application sidebar"><div className="sidebar-brand"><Link href="/dashboard" aria-label="ResolveAI overview"><ResolveAILogo size="sm" decorative /><span className="sidebar-wordmark">resolve<span className="brand-accent">ai</span></span></Link><button type="button" className="sidebar-toggle" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><Icon name="menu" /></button></div><nav className="sidebar-nav" aria-label="Primary"><span className="sidebar-section-label">Workspace</span>{primary.map(([label, href, icon]) => <Link onClick={onNavigate} className={pathname === href ? 'active' : ''} href={href} key={href} title={collapsed ? label : undefined}><Icon name={icon} /><span>{label}</span></Link>)}<span className="sidebar-section-label">Manage</span>{workspaceLinks.map(([label, href, icon]) => <Link onClick={onNavigate} className={pathname.startsWith(href) ? 'active' : ''} href={href} key={href} title={collapsed ? label : undefined}><Icon name={icon} /><span>{label}</span></Link>)}</nav><div className="sidebar-footer"><span className="status-dot" /> <span>ResolveAI workspace</span></div></aside>;
}

function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  if (!user) return null;
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`;
  async function signOut(): Promise<void> { setSigningOut(true); try { await logout(); } finally { router.replace('/login'); } }
  return <div className="user-menu"><button type="button" className="user-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span className="user-avatar">{initials}</span><span className="user-copy"><strong>{user.firstName} {user.lastName}</strong><small>{user.email}</small></span><Icon name="chevron" /></button>{open && <div className="user-dropdown"><Link href="/dashboard/settings/general" onClick={() => setOpen(false)}>Profile & settings</Link><button type="button" disabled={signingOut} onClick={() => { void signOut(); }}><Icon name="logout" /> {signingOut ? 'Signing out…' : 'Sign out'}</button></div>}</div>;
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, sessionExpired, clearSession } = useAuth();
  const { organizations, workspaces, currentOrganization, currentWorkspace, organizationRole, workspaceRole, loading, error, selectOrganization, selectWorkspace, reload } = useDashboard();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const pageTitle = pathname === '/dashboard' ? 'Overview' : pathname.split('/').filter(Boolean).pop()?.replaceAll('-', ' ') ?? 'Overview';
  function leaveExpiredSession(): void { clearSession(); router.replace('/login?reason=session-expired'); }
  useEffect(() => { if (sessionExpired) void leaveExpiredSession(); }, [sessionExpired]);
  if (authLoading) return <div className="auth-layout"><div className="auth-loading">Checking your secure session…</div></div>;
  if (!user || sessionExpired) return null;
  return <div className="dashboard-app"><div className="dashboard-mobile-bar"><Link href="/dashboard" className="brand" aria-label="ResolveAI overview"><ResolveAILogo size="sm" decorative /><span>resolve<span className="brand-accent">ai</span></span></Link><button type="button" className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button></div><div className={`dashboard-sidebar-layer${mobileOpen ? ' is-open' : ''}`} onClick={() => setMobileOpen(false)}><div onClick={(event) => event.stopPropagation()}><Sidebar collapsed={collapsed} onToggle={() => setCollapsed((current) => !current)} onNavigate={() => setMobileOpen(false)} /></div></div><div className={`dashboard-main${collapsed ? ' sidebar-collapsed' : ''}`}><header className="dashboard-topbar"><div className="topbar-context"><Switcher label="Organization" value={currentOrganization?.name ?? ''} options={organizations} onChange={selectOrganization} /><span className="context-divider">/</span><Switcher label="Workspace" value={currentWorkspace?.name ?? ''} options={workspaces} onChange={selectWorkspace} /></div><UserMenu /></header><main className="dashboard-page"><div className="page-heading"><div><p className="eyebrow"><span className="eyebrow-dot" /> Workspace</p><h1>{pageTitle}</h1></div><div className="page-meta">{organizationRole ?? 'Member'} · {workspaceRole ?? 'Workspace access'}</div></div>{sessionExpired && <div className="dashboard-error" role="alert"><span>Your session expired. Sign in again to continue.</span><button type="button" onClick={() => { void leaveExpiredSession(); }}>Sign in</button></div>}{loading && !sessionExpired && <div className="dashboard-inline-status" role="status">Loading your workspace…</div>}{error && !sessionExpired && <div className="dashboard-error" role="alert"><span>{error}</span><button type="button" onClick={() => void reload()}>Try again</button></div>}{user && !sessionExpired && children}</main></div></div>;
}
