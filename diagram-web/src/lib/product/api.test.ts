import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });

describe('ApiClient', () => {
  it('shares one refresh request and retries each 401 once', async () => {
    const session = {
      accessToken: 'fresh-token',
      user: { displayName: 'Ada', email: 'ada@example.com', id: 'user-1' }
    };
    let protectedCalls = 0;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) {
        await Promise.resolve();
        return jsonResponse(session);
      }
      protectedCalls += 1;
      if (protectedCalls <= 2) return jsonResponse({ message: 'Unauthorized' }, 401);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fresh-token');
      return jsonResponse([]);
    });
    const client = new ApiClient('', fetcher);

    await Promise.all([client.getWorkspaces(), client.getWorkspaces()]);

    expect(
      fetcher.mock.calls.filter(([input]) => String(input).endsWith('/api/auth/refresh'))
    ).toHaveLength(1);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true);
  });

  it('uses the current diagram, collaboration, version, and member contracts', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/collaboration-ticket')) {
        return jsonResponse({
          expiresAt: '2026-09-08T00:00:00Z',
          role: 'editor',
          ticket: 'one-use',
          websocketPath: '/ws/collaboration'
        });
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.endsWith('/members') && !init?.method) {
        return jsonResponse([
          {
            displayName: 'Ada',
            email: 'ada@example.com',
            role: 'viewer',
            userId: 'user-1'
          }
        ]);
      }
      return jsonResponse({ id: 'result' });
    });
    const client = new ApiClient('https://api.example', fetcher);

    await client.createDiagram('workspace-1', {
      currentConfig: '{"theme":"dark"}',
      currentContent: 'flowchart LR',
      title: 'Current contract'
    });
    const ticket = await client.createCollaborationTicket('diagram-1');
    await client.createVersion('diagram-1', 'Ready');
    await client.addDiagramMember('diagram-1', { email: 'ada@example.com', role: 'viewer' });
    const diagramMembers = await client.getDiagramMembers('diagram-1');
    await client.updateDiagramMember('diagram-1', 'user-1', { role: 'editor' });
    await client.deleteDiagramMember('diagram-1', 'user-1');
    await client.addFolderMember('folder-1', { email: 'ada@example.com', role: 'editor' });
    const folderMembers = await client.getFolderMembers('folder-1');
    await client.updateFolderMember('folder-1', 'user-1', { role: 'viewer' });
    await client.deleteFolderMember('folder-1', 'user-1');
    await client.updateFolder('folder-1', { name: 'Renamed', parentId: null });
    await client.deleteDiagram('diagram-1');
    await client.deleteFolder('folder-1');

    expect(ticket.role).toBe('editor');
    expect(diagramMembers[0]).toEqual({
      displayName: 'Ada',
      email: 'ada@example.com',
      role: 'viewer',
      userId: 'user-1'
    });
    expect(folderMembers).toEqual(diagramMembers);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      'https://api.example/api/workspaces/workspace-1/diagrams',
      'https://api.example/api/diagrams/diagram-1/collaboration-ticket',
      'https://api.example/api/diagrams/diagram-1/versions',
      'https://api.example/api/diagrams/diagram-1/members',
      'https://api.example/api/diagrams/diagram-1/members',
      'https://api.example/api/diagrams/diagram-1/members/user-1',
      'https://api.example/api/diagrams/diagram-1/members/user-1',
      'https://api.example/api/folders/folder-1/members',
      'https://api.example/api/folders/folder-1/members',
      'https://api.example/api/folders/folder-1/members/user-1',
      'https://api.example/api/folders/folder-1/members/user-1',
      'https://api.example/api/folders/folder-1',
      'https://api.example/api/diagrams/diagram-1',
      'https://api.example/api/folders/folder-1'
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      currentConfig: '{"theme":"dark"}',
      currentContent: 'flowchart LR',
      title: 'Current contract'
    });
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual([
      'POST',
      'POST',
      'POST',
      'POST',
      undefined,
      'PATCH',
      'DELETE',
      'POST',
      undefined,
      'PATCH',
      'DELETE',
      'PATCH',
      'DELETE',
      'DELETE'
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[5][1]?.body))).toEqual({ role: 'editor' });
    expect(JSON.parse(String(fetcher.mock.calls[9][1]?.body))).toEqual({ role: 'viewer' });
  });
});
