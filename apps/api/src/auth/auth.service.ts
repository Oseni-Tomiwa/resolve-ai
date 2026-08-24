import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import type { PrismaClient } from '@resolveai/database';
import type { LoginDto, RegisterDto } from './dto';
// Nest dependency injection needs this constructor token at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EmailService } from '../workspace-access/email.service';

type PublicUser = { id: string; firstName: string; lastName: string; email: string; emailVerifiedAt: Date | null; createdAt: Date; updatedAt: Date };
type Tokens = { accessToken: string; refreshToken: string };
const publicUser = (user: PublicUser & { passwordHash: string }): PublicUser => { const { passwordHash: _passwordHash, ...safe } = user; return safe; };
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(@Inject('PRISMA') private readonly db: PrismaClient, private readonly email?: EmailService) {}
  private issueTokens(userId: string): Tokens { const refreshToken = randomBytes(48).toString('base64url'); return { accessToken: jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET ?? 'development-access-secret-32-chars', { expiresIn: '15m' }), refreshToken }; }
  private async lifecycleToken(userId: string, kind: 'verification' | 'reset'): Promise<{ raw: string; expiresAt: Date }> {
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + (kind === 'verification' ? 24 : 1) * 60 * 60 * 1000);
    const data = { userId, tokenHash: hashToken(raw), expiresAt };
    if (kind === 'verification') await this.db.emailVerificationToken.create({ data });
    else await this.db.passwordResetToken.create({ data });
    return { raw, expiresAt };
  }
  private previewUrl(path: string, raw: string): string | undefined { return process.env.NODE_ENV === 'production' ? undefined : `${process.env.WEB_URL ?? 'http://localhost:3000'}${path}?token=${encodeURIComponent(raw)}`; }
  async register(dto: RegisterDto): Promise<{ user: PublicUser; tokens: Tokens; verificationUrl?: string }> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Unable to create account with these details');
    const user = await this.db.user.create({ data: { firstName: dto.firstName.trim(), lastName: dto.lastName.trim(), email, passwordHash: await argon2.hash(dto.password) } });
    const token = await this.lifecycleToken(user.id, 'verification');
    await this.email?.sendVerification({ email, url: this.previewUrl('/verify-email', token.raw) ?? `${process.env.WEB_URL ?? ''}/verify-email`, expiresAt: token.expiresAt });
    const tokens = this.issueTokens(user.id); await this.persistRefresh(user.id, tokens.refreshToken);
    return { user: publicUser(user), tokens, verificationUrl: this.previewUrl('/verify-email', token.raw) };
  }
  async login(dto: LoginDto): Promise<{ user: PublicUser; tokens: Tokens }> {
    const user = await this.db.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) throw new UnauthorizedException('Invalid email or password');
    if (!user.emailVerifiedAt) throw new ForbiddenException('Please verify your email before signing in');
    const tokens = this.issueTokens(user.id); await this.persistRefresh(user.id, tokens.refreshToken); return { user: publicUser(user), tokens };
  }
  async verifyEmail(raw: string): Promise<PublicUser> {
    const token = await this.db.emailVerificationToken.findFirst({ where: { tokenHash: hashToken(raw), usedAt: null, expiresAt: { gt: new Date() } }, include: { user: true } });
    if (!token) throw new UnauthorizedException('This verification link is invalid or expired');
    await this.db.$transaction([this.db.emailVerificationToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }), this.db.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } })]);
    return publicUser(token.user);
  }
  async resendVerification(emailAddress: string): Promise<{ sent: true; previewUrl?: string }> {
    const user = await this.db.user.findUnique({ where: { email: emailAddress.trim().toLowerCase() } });
    if (user && !user.emailVerifiedAt) { await this.db.emailVerificationToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }); const token = await this.lifecycleToken(user.id, 'verification'); const url = this.previewUrl('/verify-email', token.raw); await this.email?.sendVerification({ email: user.email, url: url ?? `${process.env.WEB_URL ?? ''}/verify-email`, expiresAt: token.expiresAt }); return { sent: true, ...(url ? { previewUrl: url } : {}) }; }
    return { sent: true };
  }
  async forgotPassword(emailAddress: string): Promise<{ sent: true }> {
    const user = await this.db.user.findUnique({ where: { email: emailAddress.trim().toLowerCase() } });
    if (user) {
      await this.db.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      const token = await this.lifecycleToken(user.id, 'reset');
      const url = this.previewUrl('/reset-password', token.raw);
      try {
        await this.email?.sendPasswordReset({ email: user.email, url: url ?? `${process.env.WEB_URL ?? ''}/reset-password`, expiresAt: token.expiresAt });
      } catch {
        // Keep this endpoint indistinguishable for existing and unknown accounts.
      }
      return { sent: true };
    }
    return { sent: true };
  }
  async resetPassword(raw: string, password: string): Promise<void> {
    const tokenHash = hashToken(raw);
    await this.db.$transaction(async (tx) => {
      const token = await tx.passwordResetToken.findFirst({ where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } } });
      if (!token) throw new UnauthorizedException('This password reset link is invalid or expired');
      const consumed = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
      if (consumed.count !== 1) throw new UnauthorizedException('This password reset link is invalid or expired');
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash: await argon2.hash(password) } });
      await tx.refreshToken.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
  }
  private async persistRefresh(userId: string, token: string): Promise<void> { await this.db.refreshToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } }); }
  async refresh(token: string): Promise<Tokens> { const stored = await this.db.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } }); if (!stored || stored.revokedAt || stored.expiresAt < new Date()) throw new UnauthorizedException('Invalid refresh token'); const next = this.issueTokens(stored.userId); await this.db.$transaction([this.db.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }), this.db.refreshToken.create({ data: { userId: stored.userId, tokenHash: hashToken(next.refreshToken), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } })]); return next; }
  async logout(token: string): Promise<void> { await this.db.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } }); }
  async me(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Unauthorized');
    const memberships = await this.db.organizationMember.findMany({ where: { userId }, include: { organization: { include: { workspaces: { where: { members: { some: { userId } } }, orderBy: { createdAt: 'asc' } } } } }, orderBy: { createdAt: 'desc' } });
    const currentOrganization = memberships[0]?.organization ?? null;
    return { user: publicUser(user), onboarding: { required: memberships.length === 0, organizations: memberships.map(({ organization }) => organization), currentOrganization, currentWorkspace: currentOrganization?.workspaces[0] ?? null } };
  }
}
