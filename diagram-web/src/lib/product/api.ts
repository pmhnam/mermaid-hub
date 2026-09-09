import type {
  AuthResponse,
  AddMemberInput,
  CollaborationTicket,
  CreateDiagramInput,
  CreateFolderInput,
  Diagram,
  DiagramVersion,
  Folder,
  LoginInput,
  PublicDiagram,
  PublicLink,
  PublicLinkMode,
  RegisterInput,
  ResourceMember,
  UpdateDiagramInput,
  UpdateFolderInput,
  UpdateMemberInput,
  User,
  Workspace,
  WorkspaceTree
} from './types';

type SessionListener = (session: AuthResponse | null) => void;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const responseError = async (response: Response): Promise<ApiError> => {
  let message = response.statusText || 'Request failed';
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) message = body.message.join(', ');
    else if (body.message) message = body.message;
  } catch {
    // Preserve the HTTP status text for empty and non-JSON errors.
  }
  return new ApiError(message, response.status);
};

export class ApiClient {
  private accessToken: string | null = null;
  private refreshRequest: Promise<AuthResponse> | null = null;

  constructor(
    private readonly baseUrl = '',
    private readonly fetcher: typeof fetch = fetch,
    private readonly onSession: SessionListener = () => undefined
  ) {}

  async login(input: LoginInput): Promise<AuthResponse> {
    return this.startSession('/api/auth/login', input);
  }

  async register(input: RegisterInput): Promise<AuthResponse> {
    return this.startSession('/api/auth/register', input);
  }

  async refresh(): Promise<AuthResponse> {
    this.refreshRequest ??= this.fetchJson<AuthResponse>('/api/auth/refresh', {
      method: 'POST'
    })
      .then((session) => {
        this.setSession(session);
        return session;
      })
      .catch((error: unknown) => {
        this.setSession(null);
        throw error;
      })
      .finally(() => {
        this.refreshRequest = null;
      });
    return this.refreshRequest;
  }

  async logout(): Promise<void> {
    try {
      await this.request<undefined>('/api/auth/logout', { method: 'POST' });
    } finally {
      this.setSession(null);
    }
  }

  getMe(): Promise<User> {
    return this.request('/api/auth/me');
  }

  getWorkspaces(): Promise<Workspace[]> {
    return this.request('/api/workspaces');
  }

  getWorkspaceTree(workspaceId: string): Promise<WorkspaceTree> {
    return this.request(`/api/workspaces/${workspaceId}/tree`);
  }

  createFolder(workspaceId: string, input: CreateFolderInput): Promise<Folder> {
    return this.request(`/api/workspaces/${workspaceId}/folders`, {
      body: JSON.stringify(input),
      method: 'POST'
    });
  }

  updateFolder(folderId: string, input: UpdateFolderInput): Promise<Folder> {
    return this.request(`/api/folders/${folderId}`, {
      body: JSON.stringify(input),
      method: 'PATCH'
    });
  }

  deleteFolder(folderId: string): Promise<void> {
    return this.request(`/api/folders/${folderId}`, { method: 'DELETE' });
  }

  createDiagram(workspaceId: string, input: CreateDiagramInput): Promise<Diagram> {
    return this.request(`/api/workspaces/${workspaceId}/diagrams`, {
      body: JSON.stringify(input),
      method: 'POST'
    });
  }

  getDiagram(diagramId: string): Promise<Diagram> {
    return this.request(`/api/diagrams/${diagramId}`);
  }

  updateDiagram(diagramId: string, input: UpdateDiagramInput): Promise<Diagram> {
    return this.request(`/api/diagrams/${diagramId}`, {
      body: JSON.stringify(input),
      method: 'PATCH'
    });
  }

  deleteDiagram(diagramId: string): Promise<void> {
    return this.request(`/api/diagrams/${diagramId}`, { method: 'DELETE' });
  }

  createCollaborationTicket(diagramId: string): Promise<CollaborationTicket> {
    return this.request(`/api/diagrams/${diagramId}/collaboration-ticket`, { method: 'POST' });
  }

  getPublicLink(diagramId: string): Promise<PublicLink> {
    return this.request(`/api/diagrams/${diagramId}/public-link`);
  }

  upsertPublicLink(diagramId: string, mode: PublicLinkMode): Promise<PublicLink> {
    return this.request(`/api/diagrams/${diagramId}/public-link`, {
      body: JSON.stringify({ mode }),
      method: 'PUT'
    });
  }

  revokePublicLink(diagramId: string): Promise<void> {
    return this.request(`/api/diagrams/${diagramId}/public-link`, { method: 'DELETE' });
  }

  rotatePublicLink(diagramId: string): Promise<PublicLink> {
    return this.request(`/api/diagrams/${diagramId}/public-link/rotate`, { method: 'POST' });
  }

  resolvePublicDiagram(shareToken: string): Promise<PublicDiagram> {
    return this.publicRequest('/api/public/diagram', shareToken);
  }

  createPublicCollaborationTicket(shareToken: string): Promise<CollaborationTicket> {
    return this.publicRequest('/api/public/diagram/collaboration-ticket', shareToken, {
      method: 'POST'
    });
  }

  getVersions(diagramId: string): Promise<DiagramVersion[]> {
    return this.request(`/api/diagrams/${diagramId}/versions`);
  }

  getVersion(diagramId: string, versionId: string): Promise<DiagramVersion> {
    return this.request(`/api/diagrams/${diagramId}/versions/${versionId}`);
  }

  createVersion(diagramId: string, message?: string): Promise<DiagramVersion> {
    return this.request(`/api/diagrams/${diagramId}/versions`, {
      body: JSON.stringify({ message: message?.trim() || undefined }),
      method: 'POST'
    });
  }

  restoreVersion(diagramId: string, versionId: string): Promise<DiagramVersion> {
    return this.request(`/api/diagrams/${diagramId}/versions/${versionId}/restore`, {
      method: 'POST'
    });
  }

  addDiagramMember(diagramId: string, input: AddMemberInput): Promise<void> {
    return this.request(`/api/diagrams/${diagramId}/members`, {
      body: JSON.stringify(input),
      method: 'POST'
    });
  }

  getDiagramMembers(diagramId: string): Promise<ResourceMember[]> {
    return this.request(`/api/diagrams/${diagramId}/members`);
  }

  updateDiagramMember(diagramId: string, userId: string, input: UpdateMemberInput): Promise<void> {
    return this.request(`/api/diagrams/${diagramId}/members/${userId}`, {
      body: JSON.stringify(input),
      method: 'PATCH'
    });
  }

  deleteDiagramMember(diagramId: string, userId: string): Promise<void> {
    return this.request(`/api/diagrams/${diagramId}/members/${userId}`, { method: 'DELETE' });
  }

  addFolderMember(folderId: string, input: AddMemberInput): Promise<void> {
    return this.request(`/api/folders/${folderId}/members`, {
      body: JSON.stringify(input),
      method: 'POST'
    });
  }

  getFolderMembers(folderId: string): Promise<ResourceMember[]> {
    return this.request(`/api/folders/${folderId}/members`);
  }

  updateFolderMember(folderId: string, userId: string, input: UpdateMemberInput): Promise<void> {
    return this.request(`/api/folders/${folderId}/members/${userId}`, {
      body: JSON.stringify(input),
      method: 'PATCH'
    });
  }

  deleteFolderMember(folderId: string, userId: string): Promise<void> {
    return this.request(`/api/folders/${folderId}/members/${userId}`, { method: 'DELETE' });
  }

  private async startSession(path: string, input: LoginInput | RegisterInput) {
    const session = await this.fetchJson<AuthResponse>(path, {
      body: JSON.stringify(input),
      method: 'POST'
    });
    this.setSession(session);
    return session;
  }

  private setSession(session: AuthResponse | null): void {
    this.accessToken = session?.accessToken ?? null;
    this.onSession(session);
  }

  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`);
    try {
      return await this.fetchJson<T>(path, { ...init, headers });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || !retry) throw error;
      await this.refresh();
      return this.request<T>(path, init, false);
    }
  }

  private publicRequest<T>(path: string, shareToken: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `DiagramLink ${shareToken}`);
    return this.fetchJson(path, { ...init, credentials: 'omit', headers });
  }

  private async fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      credentials: init.credentials ?? 'include',
      headers
    });
    if (!response.ok) throw await responseError(response);
    if (response.status === 204) return undefined as T;
    const body = await response.text();
    return body ? (JSON.parse(body) as T) : (undefined as T);
  }
}
