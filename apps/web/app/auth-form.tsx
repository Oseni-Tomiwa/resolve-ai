'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-provider';
import { apiRequest } from './api-client';
import { ResolveAILogo } from './resolveai-logo';

type AuthMode = 'login' | 'register';
type FormValues = { firstName: string; lastName: string; email: string; password: string; confirmPassword: string };
const initialValues: FormValues = { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' };

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const { user, onboarding, loading, login, register } = useAuth();
  const isRegister = mode === 'register';
  const [values, setValues] = useState<FormValues>(initialValues);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const sessionExpired = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('reason') === 'session-expired';

  useEffect(() => { if (!loading && user) router.replace(onboarding?.required ? '/onboarding' : '/dashboard'); }, [loading, onboarding, router, user]);

  function updateValue(field: keyof FormValues, value: string): void { setValues((current) => ({ ...current, [field]: value })); setFieldError(''); setError(''); }

  function validate(): boolean {
    if (isRegister && (!values.firstName.trim() || !values.lastName.trim())) { setFieldError('Please enter your first and last name.'); return false; }
    if (!/^\S+@\S+\.\S+$/.test(values.email)) { setFieldError('Enter a valid email address.'); return false; }
    if (values.password.length < 12 || !/[A-Z]/.test(values.password) || !/[a-z]/.test(values.password) || !/[0-9]/.test(values.password)) { setFieldError('Use at least 12 characters with uppercase, lowercase, and a number.'); return false; }
    if (isRegister && values.password !== values.confirmPassword) { setFieldError('Passwords do not match.'); return false; }
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setError(''); setFieldError(''); if (!validate()) return; setIsSubmitting(true);
    try {
      if (isRegister) { const result = await register({ firstName: values.firstName.trim(), lastName: values.lastName.trim(), email: values.email.trim(), password: values.password }); const invitationQuery = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('invitation'); router.push(`/verify-email?email=${encodeURIComponent(values.email.trim())}${result.verificationUrl ? `&preview=${encodeURIComponent(result.verificationUrl)}` : ''}${invitationQuery ? `&invitation=${encodeURIComponent(invitationQuery)}` : ''}`); return; } else await login({ email: values.email.trim(), password: values.password.trim() });
      const invitationToken = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('invitation');
      if (invitationToken) await apiRequest<null>('/workspace-invitations/accept', { method: 'POST', body: JSON.stringify({ token: invitationToken }) });
      router.push(invitationToken ? '/dashboard' : (isRegister || onboarding?.required ? '/onboarding' : '/dashboard'));
    } catch (caughtError) { setError(caughtError instanceof Error ? caughtError.message : 'Unable to connect. Please try again.'); } finally { setIsSubmitting(false); }
  }

  if (loading || user) return <div className="auth-layout"><div className="auth-loading">Restoring your secure session…</div></div>;
  return <div className="auth-layout"><div className="auth-brand-row"><Link className="brand" href="/"><ResolveAILogo size="sm" decorative /><span>resolve<span className="brand-accent">ai</span></span></Link><Link className="back-link" href="/">← Back to home</Link></div><main className="auth-card"><div className="auth-heading"><div className="auth-icon">{isRegister ? '✦' : '↗'}</div><div><p className="eyebrow">{isRegister ? 'Start with clarity' : 'Welcome back'}</p><h1>{isRegister ? 'Create your account' : 'Sign in to ResolveAI'}</h1><p>{isRegister ? 'Your calmer support workspace starts here.' : 'Pick up where your team left off.'}</p></div></div>{sessionExpired && !isRegister && <p className="form-notice" role="status">Your session expired. Sign in again to continue.</p>}{!isRegister && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('reason') === 'password-reset' && <p className="form-notice" role="status">Your password was updated. Sign in with your new password.</p>}<form onSubmit={submit} noValidate>{isRegister && <div className="name-fields"><label>First name<input value={values.firstName} onChange={(event) => updateValue('firstName', event.target.value)} autoComplete="given-name" /></label><label>Last name<input value={values.lastName} onChange={(event) => updateValue('lastName', event.target.value)} autoComplete="family-name" /></label></div>}<label>Email address<input value={values.email} onChange={(event) => updateValue('email', event.target.value)} type="email" autoComplete="email" placeholder="you@company.com" /></label><label>Password<div className="password-field"><input value={values.password} onChange={(event) => updateValue('password', event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder="••••••••••••" /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></div>{!isRegister && <Link className="forgot-password-link" href="/forgot-password">Forgot password?</Link>}</label>{isRegister && <><p className="password-hint">Use 12+ characters with uppercase, lowercase, and a number.</p><label>Confirm password<input value={values.confirmPassword} onChange={(event) => updateValue('confirmPassword', event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="••••••••••••" /></label></>}{fieldError && <p className="form-error" role="alert">{fieldError}</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? <><span className="spinner" /> {isRegister ? 'Creating account…' : 'Signing in…'}</> : <>{isRegister ? 'Create account' : 'Sign in'} <span aria-hidden="true">↗</span></>}</button></form><p className="auth-switch">{isRegister ? 'Already have an account?' : "Don't have an account?"} <Link href={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create one'}</Link></p></main><p className="auth-footer">Secure workspace access · ResolveAI</p></div>;
}
