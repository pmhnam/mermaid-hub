import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Diagram } from '../diagrams/entities/diagram.entity.js';
import { Folder } from '../folders/entities/folder.entity.js';
import { Workspace } from './entities/workspace.entity.js';

export interface AccessibleWorkspace extends Workspace {
  role: 'member' | 'owner' | null;
  effectiveRole: 'viewer' | 'editor' | 'owner';
}

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Folder) private readonly folders: Repository<Folder>,
    @InjectRepository(Diagram) private readonly diagrams: Repository<Diagram>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(userId: string) {
    return this.findAccessible(userId);
  }

  async findOne(id: string, userId: string) {
    return this.requireAccessible(id, userId);
  }

  async getTree(id: string, userId: string) {
    const workspace = await this.requireAccessible(id, userId);
    const hasFullAccess =
      workspace.ownerId === userId || workspace.role !== null;
    const [folders, diagrams] = await Promise.all([
      hasFullAccess
        ? this.folders.find({
            where: { workspaceId: id },
            order: { path: 'ASC' },
          })
        : this.findGrantedFolders(id, userId),
      hasFullAccess
        ? this.diagrams.find({
            where: { workspaceId: id },
            order: { title: 'ASC' },
          })
        : this.findGrantedDiagrams(id, userId),
    ]);
    return {
      workspace,
      folders: hasFullAccess ? folders : makeSafePartialTree(folders),
      diagrams,
    };
  }

  private async requireAccessible(
    id: string,
    userId: string,
  ): Promise<AccessibleWorkspace> {
    const [workspace] = await this.findAccessible(userId, id);
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  private async findAccessible(
    userId: string,
    workspaceId?: string,
  ): Promise<AccessibleWorkspace[]> {
    return this.dataSource.query(
      `SELECT w.id, w.name, w.kind, w.owner_id AS "ownerId",
        w.created_at AS "createdAt", w.updated_at AS "updatedAt",
        w.deleted_at AS "deletedAt", wm.role,
        CASE GREATEST(
          CASE WHEN w.owner_id = $1 OR wm.role = 'owner' THEN 3 ELSE 0 END,
          CASE WHEN wm.role = 'member' THEN 1 ELSE 0 END,
          COALESCE((SELECT MAX(CASE fm.role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END)
            FROM folder_members fm
            JOIN folders f ON f.id = fm.folder_id AND f.deleted_at IS NULL
            WHERE fm.user_id = $1 AND f.workspace_id = w.id), 0),
          COALESCE((SELECT MAX(CASE dm.role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END)
            FROM diagram_members dm
            JOIN diagrams d ON d.id = dm.diagram_id AND d.deleted_at IS NULL AND d.folder_id IS NULL
            WHERE dm.user_id = $1 AND d.workspace_id = w.id), 0)
        ) WHEN 3 THEN 'owner' WHEN 2 THEN 'editor' ELSE 'viewer' END AS "effectiveRole"
      FROM workspaces w
      LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
      WHERE w.deleted_at IS NULL
        AND ($2::uuid IS NULL OR w.id = $2)
        AND (w.owner_id = $1 OR wm.id IS NOT NULL
          OR EXISTS (SELECT 1 FROM folder_members fm JOIN folders f ON f.id = fm.folder_id
            WHERE fm.user_id = $1 AND f.workspace_id = w.id AND f.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM diagram_members dm JOIN diagrams d ON d.id = dm.diagram_id
            WHERE dm.user_id = $1 AND d.workspace_id = w.id
              AND d.folder_id IS NULL AND d.deleted_at IS NULL))
      ORDER BY w.created_at ASC`,
      [userId, workspaceId ?? null],
    ) as Promise<AccessibleWorkspace[]>;
  }

  private findGrantedFolders(workspaceId: string, userId: string) {
    return this.folders
      .createQueryBuilder('folder')
      .where('folder.workspaceId = :workspaceId', { workspaceId })
      .andWhere('folder.deletedAt IS NULL')
      .andWhere(
        `EXISTS (SELECT 1 FROM folders granted
          JOIN folder_members fm ON fm.folder_id = granted.id AND fm.user_id = :userId
          WHERE granted.deleted_at IS NULL AND granted.path @> folder.path)`,
        { userId },
      )
      .orderBy('folder.path', 'ASC')
      .getMany();
  }

  private findGrantedDiagrams(workspaceId: string, userId: string) {
    return this.diagrams
      .createQueryBuilder('diagram')
      .where('diagram.workspaceId = :workspaceId', { workspaceId })
      .andWhere('diagram.deletedAt IS NULL')
      .andWhere(
        `(diagram.folderId IS NULL AND EXISTS (
            SELECT 1 FROM diagram_members dm
            WHERE dm.diagram_id = diagram.id AND dm.user_id = :userId
          )) OR (diagram.folderId IS NOT NULL AND EXISTS (
            SELECT 1 FROM folders target
            JOIN folders granted ON granted.path @> target.path AND granted.deleted_at IS NULL
            JOIN folder_members fm ON fm.folder_id = granted.id AND fm.user_id = :userId
            WHERE target.id = diagram.folder_id AND target.deleted_at IS NULL
          ))`,
        { userId },
      )
      .orderBy('diagram.title', 'ASC')
      .getMany();
  }
}

function makeSafePartialTree(folders: Folder[]): Folder[] {
  const visible = new Map(folders.map((folder) => [folder.id, folder]));
  const safe = new Map<string, Folder>();
  const copy = (folder: Folder): Folder => {
    const cached = safe.get(folder.id);
    if (cached) return cached;
    const parent = folder.parentId ? visible.get(folder.parentId) : undefined;
    const safeParent = parent ? copy(parent) : undefined;
    const result = Object.assign(new Folder(), folder, {
      parentId: safeParent?.id ?? null,
      path: safeParent
        ? `${safeParent.path}.f_${folder.id.replaceAll('-', '')}`
        : `f_${folder.id.replaceAll('-', '')}`,
      depth: safeParent ? safeParent.depth + 1 : 0,
    });
    safe.set(folder.id, result);
    return result;
  };
  return folders.map(copy);
}
