import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AddMemberDto } from '../common/dto/add-member.dto.js';
import { UpdateMemberDto } from '../common/dto/update-member.dto.js';
import { Folder } from '../folders/entities/folder.entity.js';
import { ResourceRole } from '../permissions/permission.types.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { User } from '../users/entities/user.entity.js';
import { CreateDiagramDto } from './dto/create-diagram.dto.js';
import { UpdateDiagramDto } from './dto/update-diagram.dto.js';
import { DiagramMember } from './entities/diagram-member.entity.js';
import { Diagram } from './entities/diagram.entity.js';
import { YdocManagerService } from '../collaboration/ydoc-manager/ydoc-manager.service.js';

@Injectable()
export class DiagramsService {
  constructor(
    @InjectRepository(Diagram) private readonly diagrams: Repository<Diagram>,
    @InjectRepository(Folder) private readonly folders: Repository<Folder>,
    private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
    @Optional() private readonly documents?: YdocManagerService,
  ) {}

  async create(workspaceId: string, userId: string, dto: CreateDiagramDto) {
    await this.assertFolder(workspaceId, dto.folderId);
    if (dto.folderId) {
      await this.permissions.requireFolderRole(
        userId,
        dto.folderId,
        ResourceRole.Editor,
      );
    } else {
      await this.permissions.requireWorkspaceRole(userId, workspaceId);
    }
    return this.diagrams.save(
      this.diagrams.create({
        workspaceId,
        folderId: dto.folderId ?? null,
        ownerId: userId,
        title: dto.title.trim(),
        currentContent: dto.currentContent ?? '',
        currentConfig: dto.currentConfig ?? '',
        yjsState: null,
        versionSeq: 0,
        currentVersionId: null,
      }),
    );
  }

  async findOne(id: string, userId: string) {
    const diagram = await this.load(id);
    await this.permissions.requireDiagramRole(userId, id, ResourceRole.Viewer);
    return diagram;
  }

  async update(id: string, userId: string, dto: UpdateDiagramDto) {
    await this.permissions.requireDiagramRole(userId, id, ResourceRole.Editor);
    return this.dataSource.transaction(async (manager) => {
      const diagram = await manager
        .getRepository(Diagram)
        .createQueryBuilder('diagram')
        .setLock('pessimistic_write')
        .where('diagram.id = :id', { id })
        .getOne();
      if (!diagram) throw new NotFoundException('Diagram not found');

      if (dto.folderId !== undefined && dto.folderId !== diagram.folderId) {
        if (dto.folderId) {
          const folder = await manager.findOneBy(Folder, {
            id: dto.folderId,
            workspaceId: diagram.workspaceId,
          });
          if (!folder) {
            throw new BadRequestException('Folder is not in this workspace');
          }
          await this.permissions.requireFolderRole(
            userId,
            dto.folderId,
            ResourceRole.Editor,
          );
        } else {
          await this.permissions.requireWorkspaceRole(
            userId,
            diagram.workspaceId,
          );
        }
        diagram.folderId = dto.folderId;
      }
      if (dto.title !== undefined) diagram.title = dto.title.trim();
      if (dto.currentContent !== undefined) {
        diagram.currentContent = dto.currentContent;
      }
      if (dto.currentConfig !== undefined) {
        diagram.currentConfig = dto.currentConfig;
      }
      return manager.save(Diagram, diagram);
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const diagram = await this.load(id);
    await this.permissions.requireDiagramRole(userId, id, ResourceRole.Owner);
    await this.diagrams.softRemove(diagram);
  }

  async addMember(id: string, userId: string, dto: AddMemberDto) {
    const diagram = await this.requireRootOwner(id, userId);
    const user = await this.findUserByEmail(dto.email);
    try {
      return await this.dataSource.getRepository(DiagramMember).save({
        diagramId: diagram.id,
        userId: user.id,
        role: dto.role,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('User is already a diagram member');
      }
      throw error;
    }
  }

  async findMembers(id: string, userId: string) {
    await this.requireRootOwner(id, userId);
    return this.dataSource
      .getRepository(DiagramMember)
      .createQueryBuilder('member')
      .innerJoin('member.user', 'user')
      .select('member.userId', 'userId')
      .addSelect('user.email', 'email')
      .addSelect('user.displayName', 'displayName')
      .addSelect('member.role', 'role')
      .where('member.diagramId = :id', { id })
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
    await this.requireRootOwner(id, userId);
    const member = await this.dataSource
      .getRepository(DiagramMember)
      .findOneBy({ diagramId: id, userId: memberUserId });
    if (!member) throw new NotFoundException('Diagram member not found');
    member.role = dto.role;
    const saved = await this.dataSource
      .getRepository(DiagramMember)
      .save(member);
    this.documents?.disconnectUser(id, memberUserId);
    return saved;
  }

  async removeMember(
    id: string,
    memberUserId: string,
    userId: string,
  ): Promise<void> {
    await this.requireRootOwner(id, userId);
    const result = await this.dataSource
      .getRepository(DiagramMember)
      .delete({ diagramId: id, userId: memberUserId });
    if (!result.affected)
      throw new NotFoundException('Diagram member not found');
    this.documents?.disconnectUser(id, memberUserId);
  }

  private async requireRootOwner(id: string, userId: string): Promise<Diagram> {
    const diagram = await this.load(id);
    if (diagram.folderId) {
      throw new BadRequestException(
        'Only root diagrams have direct member grants',
      );
    }
    await this.permissions.requireDiagramRole(userId, id, ResourceRole.Owner);
    return diagram;
  }

  private async load(id: string): Promise<Diagram> {
    const diagram = await this.diagrams.findOneBy({ id });
    if (!diagram) throw new NotFoundException('Diagram not found');
    return diagram;
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

  private async assertFolder(
    workspaceId: string,
    folderId?: string,
  ): Promise<void> {
    if (
      folderId &&
      !(await this.folders.existsBy({ id: folderId, workspaceId }))
    ) {
      throw new BadRequestException('Folder is not in this workspace');
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === '23505'
  );
}
