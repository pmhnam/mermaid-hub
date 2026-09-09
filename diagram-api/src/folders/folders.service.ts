import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { YdocManagerService } from '../collaboration/ydoc-manager/ydoc-manager.service.js';
import { AddMemberDto } from '../common/dto/add-member.dto.js';
import { UpdateMemberDto } from '../common/dto/update-member.dto.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ResourceRole } from '../permissions/permission.types.js';
import { WorkspaceRole } from '../workspaces/entities/workspace-member.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CreateFolderDto } from './dto/create-folder.dto.js';
import { UpdateFolderDto } from './dto/update-folder.dto.js';
import { Folder } from './entities/folder.entity.js';
import { FolderMember } from './entities/folder-member.entity.js';

@Injectable()
export class FoldersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
    private readonly documents: YdocManagerService,
  ) {}

  async create(workspaceId: string, userId: string, dto: CreateFolderDto) {
    if (dto.parentId) {
      await this.permissions.requireFolderRole(
        userId,
        dto.parentId,
        ResourceRole.Editor,
      );
    } else {
      await this.permissions.requireWorkspaceRole(
        userId,
        workspaceId,
        WorkspaceRole.Owner,
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const parent = dto.parentId
        ? await this.loadParent(manager, dto.parentId, workspaceId)
        : null;
      const folder = manager.create(Folder, {
        id: randomUUID(),
        workspaceId,
        parentId: dto.parentId ?? null,
        name: dto.name.trim(),
        depth: parent ? parent.depth + 1 : 0,
        createdById: userId,
      });
      folder.path = buildFolderPath(folder.id, parent?.path);
      return manager.save(Folder, folder);
    });
  }

  async update(id: string, userId: string, dto: UpdateFolderDto) {
    return this.dataSource.transaction(async (manager) => {
      const folder = await manager
        .getRepository(Folder)
        .createQueryBuilder('folder')
        .setLock('pessimistic_write')
        .where('folder.id = :id', { id })
        .getOne();
      if (!folder) throw new NotFoundException('Folder not found');
      await this.permissions.requireFolderRole(
        userId,
        folder.id,
        ResourceRole.Owner,
      );

      if (dto.name !== undefined) folder.name = dto.name.trim();
      if (dto.parentId !== undefined && dto.parentId !== folder.parentId) {
        const parent = dto.parentId
          ? await this.loadParent(manager, dto.parentId, folder.workspaceId)
          : null;
        if (parent) {
          await this.permissions.requireFolderRole(
            userId,
            parent.id,
            ResourceRole.Owner,
          );
        } else {
          await this.permissions.requireWorkspaceRole(
            userId,
            folder.workspaceId,
            WorkspaceRole.Owner,
          );
        }
        assertValidFolderMove(folder.path, parent?.path);
        const oldPath = folder.path;
        const newPath = buildFolderPath(folder.id, parent?.path);
        const newDepth = parent ? parent.depth + 1 : 0;
        const depthDelta = newDepth - folder.depth;
        await manager.query(
          'UPDATE folders SET path = $1::ltree || subpath(path, nlevel($2::ltree)), depth = depth + $3, updated_at = now() WHERE path <@ $2::ltree AND path <> $2::ltree',
          [newPath, oldPath, depthDelta],
        );
        folder.parentId = dto.parentId;
        folder.path = newPath;
        folder.depth = newDepth;
      }
      return manager.save(Folder, folder);
    });
  }

  async addMember(id: string, userId: string, dto: AddMemberDto) {
    await this.requireOwner(id, userId);
    const user = await this.findUserByEmail(dto.email);
    try {
      return await this.dataSource.getRepository(FolderMember).save({
        folderId: id,
        userId: user.id,
        role: dto.role,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('User is already a folder member');
      }
      throw error;
    }
  }

  async findMembers(id: string, userId: string) {
    await this.requireOwner(id, userId);
    return this.dataSource
      .getRepository(FolderMember)
      .createQueryBuilder('member')
      .innerJoin('member.user', 'user')
      .select('member.userId', 'userId')
      .addSelect('user.email', 'email')
      .addSelect('user.displayName', 'displayName')
      .addSelect('member.role', 'role')
      .where('member.folderId = :id', { id })
      .orderBy('user.email', 'ASC')
      .getRawMany<{
        userId: string;
        email: string;
        displayName: string;
        role: ResourceRole;
      }>();
  }

  async updateMember(
    id: string,
    memberUserId: string,
    userId: string,
    dto: UpdateMemberDto,
  ) {
    await this.requireOwner(id, userId);
    const { saved, diagramIds } = await this.dataSource.transaction(
      async (manager) => {
        const members = manager.getRepository(FolderMember);
        const member = await members
          .createQueryBuilder('member')
          .setLock('pessimistic_write')
          .where('member.folderId = :id', { id })
          .andWhere('member.userId = :memberUserId', { memberUserId })
          .getOne();
        if (!member) throw new NotFoundException('Folder member not found');
        member.role = dto.role;
        return {
          saved: await members.save(member),
          diagramIds: await this.diagramIdsInSubtree(manager, id),
        };
      },
    );
    this.documents.disconnectUserFromDiagrams(diagramIds, memberUserId);
    return saved;
  }

  async removeMember(
    id: string,
    memberUserId: string,
    userId: string,
  ): Promise<void> {
    await this.requireOwner(id, userId);
    const diagramIds = await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .getRepository(FolderMember)
        .delete({ folderId: id, userId: memberUserId });
      if (!result.affected)
        throw new NotFoundException('Folder member not found');
      return this.diagramIdsInSubtree(manager, id);
    });
    this.documents.disconnectUserFromDiagrams(diagramIds, memberUserId);
  }

  private async requireOwner(id: string, userId: string): Promise<void> {
    const folder = await this.dataSource
      .getRepository(Folder)
      .findOneBy({ id });
    if (!folder) throw new NotFoundException('Folder not found');
    await this.permissions.requireFolderRole(userId, id, ResourceRole.Owner);
  }

  private async findUserByEmail(email: string): Promise<User> {
    const user = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .where('lower(user.email) = lower(:email)', { email })
      .getOne();
    if (!user) throw new NotFoundException('Registered user not found');
    return user;
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const folder = await manager.findOneBy(Folder, { id });
      if (!folder) throw new NotFoundException('Folder not found');
      await this.permissions.requireFolderRole(
        userId,
        folder.id,
        ResourceRole.Owner,
      );
      await manager.query(
        'UPDATE diagrams SET deleted_at = now() WHERE folder_id IN (SELECT id FROM folders WHERE path <@ $1::ltree) AND deleted_at IS NULL',
        [folder.path],
      );
      await manager.query(
        'UPDATE folders SET deleted_at = now() WHERE path <@ $1::ltree AND deleted_at IS NULL',
        [folder.path],
      );
    });
  }

  private async loadParent(
    manager: EntityManager,
    parentId: string,
    workspaceId: string,
  ): Promise<Folder> {
    const parent = await manager.findOneBy(Folder, {
      id: parentId,
      workspaceId,
    });
    if (!parent)
      throw new BadRequestException('Parent folder is not in this workspace');
    return parent;
  }

  private async diagramIdsInSubtree(
    manager: EntityManager,
    folderId: string,
  ): Promise<string[]> {
    const rows = (await manager.query(
      `SELECT d.id FROM folders root
        JOIN folders descendant ON descendant.path <@ root.path AND descendant.deleted_at IS NULL
        JOIN diagrams d ON d.folder_id = descendant.id AND d.deleted_at IS NULL
        WHERE root.id = $1 AND root.deleted_at IS NULL`,
      [folderId],
    )) as Array<{ id: string }>;
    return rows.map(({ id }) => id);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === '23505'
  );
}

export function folderPathLabel(id: string): string {
  return `f_${id.replaceAll('-', '')}`;
}

export function buildFolderPath(id: string, parentPath?: string): string {
  const label = folderPathLabel(id);
  return parentPath ? `${parentPath}.${label}` : label;
}

export function assertValidFolderMove(
  folderPath: string,
  parentPath?: string,
): void {
  if (
    parentPath &&
    (parentPath === folderPath || parentPath.startsWith(`${folderPath}.`))
  ) {
    throw new BadRequestException(
      'A folder cannot be moved into itself or its descendant',
    );
  }
}
