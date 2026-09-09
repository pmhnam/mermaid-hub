import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  WorkspaceMember,
  WorkspaceRole,
} from '../workspaces/entities/workspace-member.entity.js';
import {
  ResourceRole,
  resourceRoleAllows,
  resourceRoleRank,
} from './permission.types.js';

export const workspaceRoleRank: Record<WorkspaceRole, number> = {
  [WorkspaceRole.Member]: 1,
  [WorkspaceRole.Owner]: 2,
};

export function roleAllows(
  actual: WorkspaceRole,
  required: WorkspaceRole,
): boolean {
  return workspaceRoleRank[actual] >= workspaceRoleRank[required];
}

export function highestResourceRole(
  roles: Array<ResourceRole | null | undefined>,
): ResourceRole | null {
  return roles.reduce<ResourceRole | null>((highest, role) => {
    if (!role) return highest;
    return !highest || resourceRoleRank[role] > resourceRoleRank[highest]
      ? role
      : highest;
  }, null);
}

function roleFromRank(rank: number | string | null): ResourceRole | null {
  const value = Number(rank ?? 0);
  if (value >= 3) return ResourceRole.Owner;
  if (value === 2) return ResourceRole.Editor;
  if (value === 1) return ResourceRole.Viewer;
  return null;
}

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(WorkspaceMember)
    private readonly workspaceMembers: Repository<WorkspaceMember>,
    private readonly dataSource: DataSource,
  ) {}

  async requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    required = WorkspaceRole.Member,
  ): Promise<WorkspaceMember> {
    const membership = await this.workspaceMembers.findOneBy({
      userId,
      workspaceId,
    });
    if (!membership || !roleAllows(membership.role, required)) {
      throw new ForbiddenException('Insufficient workspace permission');
    }
    return membership;
  }

  async resolveDiagramRole(
    userId: string,
    diagramId: string,
  ): Promise<ResourceRole | null> {
    const [result] = (await this.dataSource.query(
      `SELECT GREATEST(
        CASE WHEN (d.owner_id = $1 AND d.folder_id IS NULL) OR w.owner_id = $1 THEN 3 ELSE 0 END,
        COALESCE((SELECT MAX(CASE wm.role WHEN 'owner' THEN 3 ELSE 1 END)
          FROM workspace_members wm WHERE wm.workspace_id = d.workspace_id AND wm.user_id = $1), 0),
        COALESCE((SELECT MAX(CASE dm.role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END)
          FROM diagram_members dm WHERE dm.diagram_id = d.id AND dm.user_id = $1 AND d.folder_id IS NULL), 0),
        COALESCE((SELECT MAX(CASE fm.role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END)
          FROM folders target
          JOIN folders ancestor ON ancestor.path @> target.path AND ancestor.deleted_at IS NULL
          JOIN folder_members fm ON fm.folder_id = ancestor.id AND fm.user_id = $1
          WHERE target.id = d.folder_id AND target.deleted_at IS NULL), 0)
      ) AS rank
      FROM diagrams d
      JOIN workspaces w ON w.id = d.workspace_id AND w.deleted_at IS NULL
      WHERE d.id = $2 AND d.deleted_at IS NULL`,
      [userId, diagramId],
    )) as Array<{ rank: number | string }>;
    return roleFromRank(result?.rank ?? null);
  }

  async requireDiagramRole(
    userId: string,
    diagramId: string,
    required: ResourceRole,
  ): Promise<ResourceRole> {
    const role = await this.resolveDiagramRole(userId, diagramId);
    if (!role || !resourceRoleAllows(role, required)) {
      throw new ForbiddenException('Insufficient diagram permission');
    }
    return role;
  }

  async resolveFolderRole(
    userId: string,
    folderId: string,
  ): Promise<ResourceRole | null> {
    const [result] = (await this.dataSource.query(
      `SELECT GREATEST(
        CASE WHEN w.owner_id = $1 THEN 3 ELSE 0 END,
        COALESCE((SELECT MAX(CASE wm.role WHEN 'owner' THEN 3 ELSE 1 END)
          FROM workspace_members wm WHERE wm.workspace_id = target.workspace_id AND wm.user_id = $1), 0),
        COALESCE((SELECT MAX(CASE fm.role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END)
          FROM folders ancestor
          JOIN folder_members fm ON fm.folder_id = ancestor.id AND fm.user_id = $1
          WHERE ancestor.path @> target.path AND ancestor.deleted_at IS NULL), 0)
      ) AS rank
      FROM folders target
      JOIN workspaces w ON w.id = target.workspace_id AND w.deleted_at IS NULL
      WHERE target.id = $2 AND target.deleted_at IS NULL`,
      [userId, folderId],
    )) as Array<{ rank: number | string }>;
    return roleFromRank(result?.rank ?? null);
  }

  async requireFolderRole(
    userId: string,
    folderId: string,
    required: ResourceRole,
  ): Promise<ResourceRole> {
    const role = await this.resolveFolderRole(userId, folderId);
    if (!role || !resourceRoleAllows(role, required)) {
      throw new ForbiddenException('Insufficient folder permission');
    }
    return role;
  }
}
