import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import WebSocket from 'ws';

interface Session {
  accessToken: string;
  user: { id: string; email: string };
}

interface Resource {
  id: string;
}

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;

databaseDescribe('Shared folder workspace access (e2e)', () => {
  let app: INestApplication;
  let httpUrl: string;

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    httpUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('unions grants, filters the tree, permits subtree creates, and disconnects on revocation', async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID()}`;
    const password = 'correct-horse-battery-staple';
    const owner = await register(`owner-${suffix}@example.test`, password);
    const editor = await register(`editor-${suffix}@example.test`, password);
    const unrelated = await register(
      `unrelated-${suffix}@example.test`,
      password,
    );
    const [workspace] = await api(owner)
      .get('/api/workspaces')
      .expect(200)
      .then((response) => response.body as Resource[]);

    const hiddenAncestor = await createFolder(owner, workspace.id, 'Container');
    const shared = await createFolder(
      owner,
      workspace.id,
      'Shared',
      hiddenAncestor.id,
    );
    const nested = await createFolder(owner, workspace.id, 'Nested', shared.id);
    const privateFolder = await createFolder(
      owner,
      workspace.id,
      'Private',
      hiddenAncestor.id,
    );
    const sharedDiagram = await createDiagram(
      owner,
      workspace.id,
      'Shared diagram',
      nested.id,
    );
    const privateDiagram = await createDiagram(
      owner,
      workspace.id,
      'Private diagram',
      privateFolder.id,
    );
    const rootGrant = await createDiagram(owner, workspace.id, 'Root grant');
    const privateRoot = await createDiagram(
      owner,
      workspace.id,
      'Private root',
    );
    const deletedFolder = await createFolder(
      owner,
      workspace.id,
      'Deleted folder',
      shared.id,
    );
    const deletedDiagram = await createDiagram(
      owner,
      workspace.id,
      'Deleted diagram',
      deletedFolder.id,
    );
    await api(owner).delete(`/api/folders/${deletedFolder.id}`).expect(204);

    await api(owner)
      .post(`/api/folders/${shared.id}/members`)
      .send({ email: editor.user.email, role: 'editor' })
      .expect(201);
    await api(owner)
      .post(`/api/diagrams/${rootGrant.id}/members`)
      .send({ email: editor.user.email, role: 'viewer' })
      .expect(201);

    await api(owner)
      .get(`/api/folders/${shared.id}/members`)
      .expect(200)
      .expect([
        {
          userId: editor.user.id,
          email: editor.user.email,
          displayName: editor.user.email.split('@')[0],
          role: 'editor',
        },
      ]);
    await api(owner)
      .get(`/api/diagrams/${rootGrant.id}/members`)
      .expect(200)
      .expect([
        {
          userId: editor.user.id,
          email: editor.user.email,
          displayName: editor.user.email.split('@')[0],
          role: 'viewer',
        },
      ]);
    await api(editor).get(`/api/folders/${shared.id}/members`).expect(403);
    await api(owner)
      .get(`/api/diagrams/${sharedDiagram.id}/members`)
      .expect(400);

    const editorWorkspaces = await api(editor)
      .get('/api/workspaces')
      .expect(200)
      .then(
        (response) =>
          response.body as Array<Resource & { effectiveRole: string }>,
      );
    expect(editorWorkspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: workspace.id, effectiveRole: 'editor' }),
      ]),
    );
    expect(
      editorWorkspaces.filter(({ id }) => id === workspace.id),
    ).toHaveLength(1);
    await api(editor).get(`/api/workspaces/${workspace.id}`).expect(200);

    const tree = await api(editor)
      .get(`/api/workspaces/${workspace.id}/tree`)
      .expect(200)
      .then(
        (response) =>
          response.body as {
            folders: Array<
              Resource & { name: string; parentId: string | null }
            >;
            diagrams: Array<Resource & { title: string }>;
          },
      );
    expect(tree.folders.map(({ id }) => id)).toEqual([shared.id, nested.id]);
    expect(tree.folders[0].parentId).toBeNull();
    expect(tree.folders[1].parentId).toBe(shared.id);
    expect(tree.diagrams.map(({ id }) => id).sort()).toEqual(
      [sharedDiagram.id, rootGrant.id].sort(),
    );
    expect(tree.folders).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: hiddenAncestor.id }),
        expect.objectContaining({ id: privateFolder.id }),
        expect.objectContaining({ id: deletedFolder.id }),
      ]),
    );
    expect(tree.diagrams).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: privateDiagram.id }),
        expect.objectContaining({ id: privateRoot.id }),
        expect.objectContaining({ id: deletedDiagram.id }),
      ]),
    );

    const editorNested = await createFolder(
      editor,
      workspace.id,
      'Editor nested',
      nested.id,
    );
    const editorDiagram = await createDiagram(
      editor,
      workspace.id,
      'Editor diagram',
      editorNested.id,
    );
    await api(editor)
      .patch(`/api/diagrams/${editorDiagram.id}`)
      .send({ folderId: nested.id })
      .expect(200);
    await api(editor)
      .patch(`/api/diagrams/${sharedDiagram.id}`)
      .send({ folderId: privateFolder.id })
      .expect(403);
    await api(editor)
      .patch(`/api/diagrams/${sharedDiagram.id}`)
      .send({ folderId: null })
      .expect(403);
    await api(editor)
      .post(`/api/workspaces/${workspace.id}/folders`)
      .send({ name: 'Forbidden root folder' })
      .expect(403);
    await api(editor)
      .post(`/api/workspaces/${workspace.id}/diagrams`)
      .send({ title: 'Forbidden root diagram' })
      .expect(403);

    const ticket = await api(editor)
      .post(`/api/diagrams/${editorDiagram.id}/collaboration-ticket`)
      .expect(201)
      .then((response) => response.body as { ticket: string });
    const socket = new WebSocket(
      httpUrl.replace('http:', 'ws:') +
        `/ws/collaboration?diagramId=${editorDiagram.id}&ticket=${ticket.ticket}`,
    );
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const closed = new Promise<number>((resolve) => {
      socket.once('close', resolve);
    });
    await api(owner)
      .delete(`/api/folders/${shared.id}/members/${editor.user.id}`)
      .expect(204);
    await expect(closed).resolves.toBe(4403);
    await api(editor).get(`/api/diagrams/${editorDiagram.id}`).expect(403);
    const rootOnlyTree = await api(editor)
      .get(`/api/workspaces/${workspace.id}/tree`)
      .expect(200)
      .then(
        (response) =>
          response.body as { folders: Resource[]; diagrams: Resource[] },
      );
    expect(rootOnlyTree.folders).toEqual([]);
    expect(rootOnlyTree.diagrams.map(({ id }) => id)).toEqual([rootGrant.id]);
    await api(editor)
      .get('/api/workspaces')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: workspace.id,
              effectiveRole: 'viewer',
            }),
          ]),
        );
      });

    const unrelatedWorkspaces = await api(unrelated)
      .get('/api/workspaces')
      .expect(200)
      .then((response) => response.body as Resource[]);
    expect(unrelatedWorkspaces.some(({ id }) => id === workspace.id)).toBe(
      false,
    );
    await api(unrelated).get(`/api/workspaces/${workspace.id}`).expect(404);
    await api(unrelated)
      .get(`/api/workspaces/${workspace.id}/tree`)
      .expect(404);
  }, 30_000);

  function api(session: Session) {
    return request
      .agent(httpUrl)
      .set('Authorization', `Bearer ${session.accessToken}`);
  }

  async function register(email: string, password: string): Promise<Session> {
    return request(httpUrl)
      .post('/api/auth/register')
      .send({ email, displayName: email.split('@')[0], password })
      .expect(201)
      .then((response) => response.body as Session);
  }

  async function createFolder(
    session: Session,
    workspaceId: string,
    name: string,
    parentId?: string,
  ): Promise<Resource> {
    return api(session)
      .post(`/api/workspaces/${workspaceId}/folders`)
      .send({ name, ...(parentId ? { parentId } : {}) })
      .expect(201)
      .then((response) => response.body as Resource);
  }

  async function createDiagram(
    session: Session,
    workspaceId: string,
    title: string,
    folderId?: string,
  ): Promise<Resource> {
    return api(session)
      .post(`/api/workspaces/${workspaceId}/diagrams`)
      .send({ title, ...(folderId ? { folderId } : {}) })
      .expect(201)
      .then((response) => response.body as Resource);
  }
});
