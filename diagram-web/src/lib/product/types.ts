export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface Workspace {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  role?: 'member' | 'owner';
}

export interface Folder {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  path: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Diagram {
  id: string;
  workspaceId: string;
  folderId: string | null;
  title: string;
  currentContent: string;
  currentConfig: string;
  currentVersionId: string | null;
  ownerId: string;
  versionSeq: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface WorkspaceTree {
  workspace: Workspace;
  folders: Folder[];
  diagrams: Diagram[];
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  displayName: string;
}

export interface CreateFolderInput {
  name: string;
  parentId?: string;
}

export interface UpdateFolderInput {
  name?: string;
  parentId?: string | null;
}

export interface CreateDiagramInput {
  title: string;
  folderId?: string;
  currentContent?: string;
  currentConfig?: string;
}

export interface UpdateDiagramInput {
  title?: string;
  folderId?: string | null;
  currentContent?: string;
  currentConfig?: string;
}

export type ResourceRole = 'viewer' | 'editor' | 'owner';

export interface CollaborationTicket {
  expiresAt: string;
  role: ResourceRole;
  ticket: string;
  websocketPath: string;
}

export interface DiagramVersion {
  config: string;
  content: string;
  createdAt: string;
  createdById: string;
  diagramId: string;
  id: string;
  message: string | null;
  type: 'checkpoint' | 'manual' | 'restore';
  versionNumber: number;
}

export interface AddMemberInput {
  email: string;
  role: Exclude<ResourceRole, 'owner'>;
}

export interface ResourceMember {
  displayName: string;
  email: string;
  role: Exclude<ResourceRole, 'owner'>;
  userId: string;
}

export interface UpdateMemberInput {
  role: Exclude<ResourceRole, 'owner'>;
}
