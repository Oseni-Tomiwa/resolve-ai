import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
jest.mock('argon2', () => ({ __esModule: true, hash: jest.fn(), verify: jest.fn() }));
jest.mock('jsonwebtoken', () => ({ __esModule: true, sign: jest.fn() }));
// Load the service after registering factories for its native and token dependencies.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService } = require('./auth.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockedArgon2 = require('argon2') as { hash: jest.Mock; verify: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockedJwt = require('jsonwebtoken') as { sign: jest.Mock };

type MockDatabase = {
  user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  emailVerificationToken: { create: jest.Mock; findFirst: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
  passwordResetToken: { create: jest.Mock; findFirst: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
  refreshToken: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  $transaction: jest.Mock;
};

const createDatabase = (): MockDatabase => ({
  user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  emailVerificationToken: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  passwordResetToken: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(),
});

const user = {
  id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', passwordHash: 'hashed-password',
  emailVerifiedAt: new Date('2025-01-01'), createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01'),
};

describe('AuthService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(mockedArgon2, 'hash').mockResolvedValue('hashed-password');
    jest.spyOn(mockedArgon2, 'verify').mockResolvedValue(true);
    jest.spyOn(mockedJwt, 'sign').mockReturnValue('access-token' as never);
  });

  it('registers a normalized user and persists a hashed refresh token', async () => {
    // Arrange
    const db = createDatabase();
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue(user);
    const service = new AuthService(db as never);

    // Act
    const result = await service.register({ firstName: ' Ada ', lastName: ' Lovelace ', email: ' ADA@EXAMPLE.COM ', password: 'Password123!' });

    // Assert
    expect(db.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', passwordHash: 'hashed-password' }) }));
    expect(db.refreshToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', tokenHash: expect.any(String) }) }));
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.tokens.accessToken).toBe('access-token');
  });

  it('logs in with a valid password and returns a public user', async () => {
    // Arrange
    const db = createDatabase();
    db.user.findUnique.mockResolvedValue(user);
    const service = new AuthService(db as never);

    // Act
    const result = await service.login({ email: 'ADA@EXAMPLE.COM', password: 'Password123!' });

    // Assert
    expect(mockedArgon2.verify).toHaveBeenCalledWith('hashed-password', 'Password123!');
    expect(result.user).toMatchObject({ id: 'user-1', email: 'ada@example.com' });
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('rejects an invalid password without revealing account details', async () => {
    // Arrange
    const db = createDatabase();
    db.user.findUnique.mockResolvedValue(user);
    mockedArgon2.verify.mockResolvedValue(false);
    const service = new AuthService(db as never);

    // Act
    const action = service.login({ email: 'ada@example.com', password: 'wrong-password' });

    // Assert
    await expect(action).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rotates a valid refresh token and revokes the previous token', async () => {
    // Arrange
    const db = createDatabase();
    db.refreshToken.findUnique.mockResolvedValue({ id: 'refresh-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60_000), revokedAt: null });
    db.refreshToken.update.mockResolvedValue({});
    db.refreshToken.create.mockResolvedValue({});
    db.$transaction.mockResolvedValue([]);
    const service = new AuthService(db as never);

    // Act
    const result = await service.refresh('old-refresh-token');

    // Assert
    expect(result.refreshToken).not.toBe('old-refresh-token');
    expect(db.refreshToken.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'refresh-1' }, data: { revokedAt: expect.any(Date) } }));
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Array));
  });

  it('requires email verification before login', async () => {
    // Arrange
    const db = createDatabase(); db.user.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: null });
    const service = new AuthService(db as never);

    // Act
    const action = service.login({ email: user.email, password: 'Password123!' });

    // Assert
    await expect(action).rejects.toThrow(new ForbiddenException('Please verify your email before signing in'));
  });

  it('consumes a valid verification token once', async () => {
    // Arrange
    const db = createDatabase(); db.emailVerificationToken.findFirst.mockResolvedValue({ id: 'verification-1', userId: user.id, user }); db.$transaction.mockResolvedValue([]);
    const service = new AuthService(db as never);

    // Act
    const result = await service.verifyEmail('verification-token-value');

    // Assert
    expect(result).not.toHaveProperty('passwordHash');
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Array));
  });

  it('returns the same forgot-password result for existing and unknown accounts', async () => {
    // Arrange
    const db = createDatabase();
    const email = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
    db.user.findUnique.mockResolvedValue(user);
    db.passwordResetToken.create.mockResolvedValue({});
    process.env.NODE_ENV = 'development';
    process.env.WEB_URL = 'http://localhost:3000';
    const service = new AuthService(db as never, email as never);

    // Act
    const existing = await service.forgotPassword(user.email);
    db.user.findUnique.mockResolvedValue(null);
    const unknown = await service.forgotPassword('missing@example.com');

    // Assert
    expect(existing).toEqual({ sent: true });
    expect(unknown).toEqual({ sent: true });
    expect(existing).toEqual(unknown);
    expect(email.sendPasswordReset).toHaveBeenCalledWith(expect.objectContaining({ email: user.email, url: expect.stringContaining('/reset-password?token=') }));
    expect(db.passwordResetToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tokenHash: expect.any(String) }) }));
    expect(db.passwordResetToken.create.mock.calls[0][0].data).not.toHaveProperty('token');
    expect(email.sendPasswordReset).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid reset token', async () => {
    // Arrange
    const db = createDatabase();
    db.$transaction.mockImplementation(async (callback: (transaction: MockDatabase) => Promise<unknown>) => callback(db));
    db.passwordResetToken.findFirst.mockResolvedValue(null);
    const service = new AuthService(db as never);

    // Act / Assert
    await expect(service.resetPassword('invalid-reset-token', 'NewPassword123!')).rejects.toThrow(new UnauthorizedException('This password reset link is invalid or expired'));
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('rejects expired and previously used reset tokens', async () => {
    // Arrange
    const db = createDatabase();
    db.$transaction.mockImplementation(async (callback: (transaction: MockDatabase) => Promise<unknown>) => callback(db));
    const service = new AuthService(db as never);

    // Act / Assert: Prisma query excludes both expired and consumed records.
    db.passwordResetToken.findFirst.mockResolvedValue(null);
    await expect(service.resetPassword('expired-reset-token', 'NewPassword123!')).rejects.toThrow(UnauthorizedException);
    await expect(service.resetPassword('used-reset-token', 'NewPassword123!')).rejects.toThrow(UnauthorizedException);
    expect(db.passwordResetToken.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ usedAt: null, expiresAt: { gt: expect.any(Date) } }) }));
  });

  it('changes the password, consumes the token, and revokes existing sessions', async () => {
    // Arrange
    const db = createDatabase();
    const mutableUser = { ...user };
    db.$transaction.mockImplementation(async (callback: (transaction: MockDatabase) => Promise<unknown>) => callback(db));
    db.passwordResetToken.findFirst.mockResolvedValue({ id: 'reset-1', userId: user.id });
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    db.user.update.mockImplementation(async ({ data }: { data: { passwordHash: string } }) => Object.assign(mutableUser, data));
    db.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    mockedArgon2.hash.mockResolvedValue('new-password-hash');
    const service = new AuthService(db as never);

    // Act
    await service.resetPassword('valid-reset-token', 'NewPassword123!');

    // Assert
    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'reset-1', usedAt: null }, data: { usedAt: expect.any(Date) } }));
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { passwordHash: 'new-password-hash' } });
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: user.id, revokedAt: null } }));
    expect(mutableUser.passwordHash).toBe('new-password-hash');
  });

  it('allows the new password and rejects the old password after reset', async () => {
    // Arrange
    const db = createDatabase();
    const mutableUser = { ...user };
    db.$transaction.mockImplementation(async (callback: (transaction: MockDatabase) => Promise<unknown>) => callback(db));
    db.passwordResetToken.findFirst.mockResolvedValue({ id: 'reset-2', userId: user.id });
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    db.user.update.mockImplementation(async ({ data }: { data: { passwordHash: string } }) => Object.assign(mutableUser, data));
    db.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    mockedArgon2.hash.mockResolvedValue('new-password-hash');
    mockedArgon2.verify.mockImplementation(async (hash: string, password: string) => hash === 'new-password-hash' && password === 'NewPassword123!');
    db.user.findUnique.mockImplementation(async () => mutableUser);
    const service = new AuthService(db as never);
    await service.resetPassword('valid-reset-token', 'NewPassword123!');

    // Act / Assert
    await expect(service.login({ email: user.email, password: 'Password123!' })).rejects.toThrow(UnauthorizedException);
    await expect(service.login({ email: user.email, password: 'NewPassword123!' })).resolves.toHaveProperty('user.email', user.email);
  });
});
