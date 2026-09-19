import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { User } from '../users/entities/user.entity.js';
import { Workspace } from '../workspaces/entities/workspace.entity.js';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity.js';

const identity = {
  subject: 'google-123',
  email: 'ada@example.com',
  displayName: 'Ada',
};
const metadata = { ipAddress: null, userAgent: null };

const setup = (existing: unknown = null, emailOwner: unknown = null) => {
  const query = {
    where: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(emailOwner),
  };
  const manager = {
    query: vi.fn(),
    findOneBy: vi.fn().mockResolvedValue(existing),
    getRepository: vi.fn(() => ({ createQueryBuilder: () => query })),
    create: vi.fn((_entity, value) => value),
    save: vi.fn(async (entity, value) => ({
      ...value,
      id: entity === User ? 'user-1' : 'workspace-1',
    })),
  };
  const dataSource = { transaction: vi.fn((callback) => callback(manager)) };
  const service = new AuthService(
    {} as never,
    {} as never,
    dataSource as never,
    new JwtService(),
    new ConfigService(),
  );
  const tokens = vi
    .spyOn(service, 'issueTokens')
    .mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: {
        id: 'user-1',
        email: identity.email,
        displayName: identity.displayName,
      },
    });
  return { service, manager, tokens };
};

describe('Google account provisioning', () => {
  it('creates a passwordless account, personal workspace and owner membership together', async () => {
    const { service, manager, tokens } = setup();
    await service.loginWithGoogle(identity, metadata);
    expect(manager.save).toHaveBeenCalledWith(
      User,
      expect.objectContaining({
        googleSubject: identity.subject,
        passwordHash: null,
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      Workspace,
      expect.objectContaining({ ownerId: 'user-1' }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      WorkspaceMember,
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        role: 'owner',
      }),
    );
    expect(tokens).toHaveBeenCalledWith(
      {
        id: 'user-1',
        email: identity.email,
        displayName: identity.displayName,
      },
      metadata,
    );
  });

  it('uses the stable Google subject for returning users without duplicating workspaces', async () => {
    const { service, manager } = setup({
      id: 'user-1',
      email: 'old@example.com',
      displayName: 'Ada',
    });
    await service.loginWithGoogle(identity, metadata);
    expect(manager.findOneBy).toHaveBeenCalledWith(User, {
      googleSubject: identity.subject,
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('does not silently link a password account by matching email', async () => {
    const { service, manager, tokens } = setup(null, { id: 'password-user' });
    await expect(service.loginWithGoogle(identity, metadata)).rejects.toThrow(
      'password',
    );
    expect(manager.save).not.toHaveBeenCalled();
    expect(tokens).not.toHaveBeenCalled();
  });

  it('rejects password login for Google-only users without calling argon2 with null', async () => {
    const query = {
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({ passwordHash: null }),
    };
    const service = new AuthService(
      { createQueryBuilder: () => query } as never,
      {} as never,
      {} as never,
      new JwtService(),
      new ConfigService(),
    );
    expect(
      await service.validateCredentials('ada@example.com', 'password'),
    ).toBeNull();
  });
});
