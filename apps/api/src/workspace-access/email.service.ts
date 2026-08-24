import { createHash } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common'; import { Queue } from 'bullmq';
import { redisConnectionOptionsFromEnv } from '@resolveai/config';

export type InvitationEmail = { invitationUrl: string; inviterName: string; organizationName: string; workspaceName: string; email: string; role: string; expiresAt: Date };
export type LifecycleEmail = { email: string; url: string; expiresAt: Date };
type EmailMessage = { to: string; subject: string; html: string; text: string; idempotencyKey: string };

const createIdempotencyJobId = (value: string): string => 'email-' + createHash('sha256').update(value).digest('hex');
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
const retry = async <T>(operation: () => Promise<T>, attempts = 3): Promise<T> => { let last: unknown; for (let attempt = 0; attempt < attempts; attempt += 1) { try { return await operation(); } catch (error) { last = error; if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt)); } } throw last; };

interface TransactionalEmailProvider { send(message: EmailMessage): Promise<void>; }
class ConsoleEmailProvider implements TransactionalEmailProvider { async send(message: EmailMessage): Promise<void> { if (process.env.NODE_ENV !== 'test') console.info(JSON.stringify({ event: 'email.preview', provider: 'console', recipientDomain: message.to.split('@')[1] ?? 'unknown', subject: message.subject })); } }
class TestEmailProvider implements TransactionalEmailProvider { readonly messages: EmailMessage[] = []; async send(message: EmailMessage): Promise<void> { this.messages.push(message); } }
class ResendEmailProvider implements TransactionalEmailProvider {
  constructor(private readonly apiKey: string, private readonly apiUrl: string, private readonly from: string, private readonly replyTo?: string) {}
  async send(message: EmailMessage): Promise<void> {
    const response = await retry(() => fetch(this.apiUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + this.apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey }, body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, html: message.html, text: message.text, ...(this.replyTo ? { reply_to: this.replyTo } : {}) }), signal: AbortSignal.timeout(15_000) }));
    if (!response.ok) throw new Error('EMAIL_PROVIDER_REJECTED_' + response.status);
  }
}

@Injectable()
export class EmailService {
  private readonly provider: TransactionalEmailProvider;
  private readonly sent = new Set<string>();
  private readonly queue: Queue | null;
  constructor() {
    const provider = process.env.EMAIL_PROVIDER ?? 'console';
    if (provider === 'resend' && process.env.EMAIL_API_KEY) this.provider = new ResendEmailProvider(process.env.EMAIL_API_KEY, process.env.EMAIL_API_URL ?? 'https://api.resend.com/emails', (process.env.EMAIL_FROM_NAME ?? 'ResolveAI') + ' <' + (process.env.EMAIL_FROM_ADDRESS ?? 'no-reply@example.com') + '>', process.env.EMAIL_REPLY_TO);
    else if (provider === 'test') this.provider = new TestEmailProvider();
    else if (provider === 'smtp') throw new Error('SMTP email provider requires an SMTP adapter; configure EMAIL_PROVIDER=resend');
    else this.provider = new ConsoleEmailProvider();
    this.queue = provider === 'resend' && process.env.NODE_ENV !== 'test' ? new Queue('email-delivery', { connection: redisConnectionOptionsFromEnv() }) : null;
  }
  private async deliver(message: EmailMessage): Promise<void> { if (this.sent.has(message.idempotencyKey)) return; try { if (this.queue) await this.queue.add('deliver-email', { message }, { jobId: createIdempotencyJobId(message.idempotencyKey), attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 100 }); else await this.provider.send(message); this.sent.add(message.idempotencyKey); } catch { throw new ServiceUnavailableException('Email delivery is temporarily unavailable'); } }
  private lifecycle(kind: string, message: LifecycleEmail, title: string): EmailMessage { const safeUrl = escapeHtml(message.url); const expires = escapeHtml(message.expiresAt.toISOString()); return { to: message.email, subject: 'ResolveAI ' + title, idempotencyKey: kind + ':' + message.email + ':' + message.url, html: '<p>Use the link below to ' + title.toLowerCase() + ':</p><p><a href="' + safeUrl + '">' + safeUrl + '</a></p><p>This link expires at ' + expires + '.</p>', text: 'Use this link to ' + title.toLowerCase() + ': ' + message.url + '\nIt expires at ' + message.expiresAt.toISOString() + '.' }; }
  async sendInvitation(message: InvitationEmail): Promise<void> { const url = escapeHtml(message.invitationUrl); await this.deliver({ to: message.email, subject: 'Invitation to ' + message.workspaceName + ' on ResolveAI', idempotencyKey: 'invitation:' + message.email + ':' + message.invitationUrl, html: '<p>' + escapeHtml(message.inviterName) + ' invited you to ' + escapeHtml(message.workspaceName) + ' in ' + escapeHtml(message.organizationName) + '.</p><p>Your role: ' + escapeHtml(message.role) + '</p><p><a href="' + url + '">Accept invitation</a></p>', text: message.inviterName + ' invited you to ' + message.workspaceName + ' in ' + message.organizationName + '.\nRole: ' + message.role + '\nAccept: ' + message.invitationUrl }); }
  async sendVerification(message: LifecycleEmail): Promise<void> { await this.deliver(this.lifecycle('verification', message, 'verify your email')); }
  async sendPasswordReset(message: LifecycleEmail): Promise<void> { await this.deliver(this.lifecycle('password-reset', message, 'reset your password')); }
  async onModuleDestroy(): Promise<void> { await this.queue?.close(); }
}
