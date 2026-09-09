import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { hash, verify, argon2id } from 'argon2';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import {
  WorkspaceMember,
  WorkspaceRole,
} from '../workspaces/entities/workspace-member.entity.js';
import {
  Workspace,
  WorkspaceKind,
} from '../workspaces/entities/workspace.entity.js';
import { AuthenticatedUser, SessionMetadata } from './auth.types.js';
import { RegisterDto } from './dto/register.dto.js';
import { AuthSession } from './entities/auth-session.entity.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  parseRefreshSessionId,
  verifyRefreshToken,
} from './session-token.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto, metadata: SessionMetadata) {
    const passwordHash = await hash(dto.password, { type: argon2id });
    try {
      const user = await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          User,
          manager.create(User, {
            email: dto.email,
            displayName: dto.displayName.trim(),
            passwordHash,
          }),
        );
        const workspace = await manager.save(
          Workspace,
          manager.create(Workspace, {
            name: `${created.displayName}'s workspace`,
            kind: WorkspaceKind.Personal,
            ownerId: created.id,
          }),
        );
        await manager.save(
          WorkspaceMember,
          manager.create(WorkspaceMember, {
            workspaceId: workspace.id,
            userId: created.id,
            role: WorkspaceRole.Owner,
          }),
        );
        return created;
      });
      return this.issueTokens(this.toPublicUser(user), metadata);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('lower(user.email) = lower(:email)', { email: email.trim() })
      .andWhere('user.deletedAt IS NULL')
      .getOne();
    if (!user || !(await verify(user.passwordHash, password))) return null;
    return this.toPublicUser(user);
  }

  issueTokens(user: AuthenticatedUser, metadata: SessionMetadata) {
    return this.createSession(user, metadata);
  }

  async refresh(token: string | undefined, metadata: SessionMetadata) {
    const sessionId = parseRefreshSessionId(token);
    if (!token || !sessionId)
      throw new UnauthorizedException('Invalid refresh token');

    return this.dataSource.transaction(async (manager) => {
      const session = await manager
        .getRepository(AuthSession)
        .createQueryBuilder('session')
        .setLock('pessimistic_write')
        .where('session.id = :sessionId', { sessionId })
        .getOne();
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        !(await verifyRefreshToken(session.refreshTokenHash, token))
      ) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      const user = await manager.findOneBy(User, { id: session.userId });
      if (!user) throw new UnauthorizedException('Invalid refresh token');

      const next = await this.buildSession(this.toPublicUser(user), metadata);
      await manager.save(AuthSession, next.session);
      session.revokedAt = new Date();
      session.lastUsedAt = new Date();
      session.replacedBySessionId = next.session.id;
      await manager.save(AuthSession, session);
      return {
        accessToken: await this.signAccessToken(this.toPublicUser(user)),
        refreshToken: next.token,
        user: this.toPublicUser(user),
      };
    });
  }

  async logout(token: string | undefined): Promise<void> {
    const sessionId = parseRefreshSessionId(token);
    if (!sessionId) return;
    await this.sessions.update(
      { id: sessionId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async createSession(
    user: AuthenticatedUser,
    metadata: SessionMetadata,
  ) {
    const built = await this.buildSession(user, metadata);
    await this.sessions.save(built.session);
    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: built.token,
      user,
    };
  }

  private async buildSession(
    user: AuthenticatedUser,
    metadata: SessionMetadata,
  ) {
    const session = this.sessions.create({
      userId: user.id,
      expiresAt: new Date(
        Date.now() +
          this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 30) * 86_400_000,
      ),
      ...metadata,
    });
    const generated = generateRefreshToken();
    session.id = generated.sessionId;
    const token = generated.token;
    session.refreshTokenHash = await hashRefreshToken(token);
    return { session, token };
  }

  private signAccessToken(user: AuthenticatedUser) {
    const expiresIn = this.config.get<string>(
      'JWT_ACCESS_TTL',
      '15m',
    ) as JwtSignOptions['expiresIn'];
    return this.jwt.signAsync(
      { sub: user.id, email: user.email },
      { expiresIn },
    );
  }

  private toPublicUser(user: User): AuthenticatedUser {
    return { id: user.id, email: user.email, displayName: user.displayName };
  }
}
