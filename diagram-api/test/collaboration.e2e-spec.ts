import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

interface Session {
  accessToken: string;
  user: { id: string; email: string };
}

interface CollaborationTicket {
  ticket: string;
  role: string;
  websocketPath: string;
}

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}${detail}`);
}

databaseDescribe('PostgreSQL WebSocket collaboration (e2e)', () => {
  let app: INestApplication;
  let httpUrl: string;
  let wsUrl: string;
  const providers: WebsocketProvider[] = [];
  const documents: Y.Doc[] = [];

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
    wsUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    for (const provider of providers) {
      (provider as WebsocketProvider & { destroy(): void }).destroy();
    }
    for (const document of documents) document.destroy();
    await app?.close();
  });

  it('collaborates, persists, versions, restores, and enforces live permissions', async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID()}`;
    const password = 'correct-horse-battery-staple';
    const owner = await register(`owner-${suffix}@example.test`, password);
    const editor = await register(`editor-${suffix}@example.test`, password);

    const workspaces = await api(owner)
      .get('/api/workspaces')
      .expect(200)
      .then((response) => response.body);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({
      kind: 'personal',
      ownerId: owner.user.id,
    });

    const initial = {
      content: 'graph TD\n  A --> B',
      config: '{"theme":"forest"}',
    };
    const diagram = await api(owner)
      .post(`/api/workspaces/${workspaces[0].id}/diagrams`)
      .send({
        title: `Collaboration ${suffix}`,
        currentContent: initial.content,
        currentConfig: initial.config,
      })
      .expect(201)
      .then((response) => response.body);

    const initialVersion = await api(owner)
      .post(`/api/diagrams/${diagram.id}/versions`)
      .send({ message: 'Initial state' })
      .expect(201)
      .then((response) => response.body);
    expect(initialVersion).toMatchObject({
      versionNumber: 1,
      content: initial.content,
      config: initial.config,
      type: 'manual',
    });

    await api(owner)
      .post(`/api/diagrams/${diagram.id}/members`)
      .send({ email: editor.user.email, role: 'editor' })
      .expect(201);

    const [ownerTicket, editorTicket] = await Promise.all([
      ticket(owner, diagram.id),
      ticket(editor, diagram.id),
    ]);
    expect(ownerTicket).toMatchObject({
      role: 'owner',
      websocketPath: '/ws/collaboration',
    });
    expect(editorTicket).toMatchObject({
      role: 'editor',
      websocketPath: '/ws/collaboration',
    });

    const ownerConnection = connect(diagram.id, ownerTicket.ticket);
    const editorConnection = connect(diagram.id, editorTicket.ticket);
    await Promise.all([
      waitFor(() => ownerConnection.provider.synced, 'owner initial sync'),
      waitFor(() => editorConnection.provider.synced, 'editor initial sync'),
    ]);
    expect(readState(ownerConnection.doc)).toEqual(initial);
    expect(readState(editorConnection.doc)).toEqual(initial);

    const reusedTicketSocket = new WebSocket(ownerConnection.provider.url);
    expect(
      await socketClose(reusedTicketSocket, 'reused ticket rejection'),
    ).toBe(4401);

    ownerConnection.doc.transact(() => {
      ownerConnection.doc
        .getText('code')
        .insert(initial.content.length, '\n  B --> C');
      ownerConnection.doc
        .getText('config')
        .insert(initial.config.length, '\nowner=true');
    });
    editorConnection.doc.transact(() => {
      editorConnection.doc.getText('code').insert(0, '%% editor\n');
      editorConnection.doc.getText('config').insert(0, 'editor=true\n');
    });

    await waitFor(
      () =>
        readState(ownerConnection.doc).content ===
          readState(editorConnection.doc).content &&
        readState(ownerConnection.doc).config ===
          readState(editorConnection.doc).config,
      'concurrent edits to converge',
    );
    const collaborativeState = readState(ownerConnection.doc);
    expect(collaborativeState.content).toContain('%% editor');
    expect(collaborativeState.content).toContain('B --> C');
    expect(collaborativeState.config).toContain('editor=true');
    expect(collaborativeState.config).toContain('owner=true');

    ownerConnection.provider.awareness.setLocalStateField('user', {
      email: owner.user.email,
    });
    editorConnection.provider.awareness.setLocalStateField('user', {
      email: editor.user.email,
    });
    await Promise.all([
      waitFor(
        () => hasAwareness(editorConnection.provider, owner.user.email),
        'owner awareness at editor',
      ),
      waitFor(
        () => hasAwareness(ownerConnection.provider, editor.user.email),
        'editor awareness at owner',
      ),
    ]);

    await waitFor(async () => {
      const response = await api(owner).get(`/api/diagrams/${diagram.id}`);
      return (
        response.status === 200 &&
        response.body.currentContent === collaborativeState.content &&
        response.body.currentConfig === collaborativeState.config &&
        response.body.yjsState !== null
      );
    }, 'collaboration state persistence through REST');

    const activeVersion = await api(editor)
      .post(`/api/diagrams/${diagram.id}/versions`)
      .send({ message: 'Collaborative state' })
      .expect(201)
      .then((response) => response.body);
    expect(activeVersion).toMatchObject({
      versionNumber: 2,
      content: collaborativeState.content,
      config: collaborativeState.config,
      type: 'manual',
    });

    const restored = await api(owner)
      .post(`/api/diagrams/${diagram.id}/versions/${initialVersion.id}/restore`)
      .expect(201)
      .then((response) => response.body);
    expect(restored).toMatchObject({
      versionNumber: 4,
      content: initial.content,
      config: initial.config,
      type: 'restore',
    });
    await Promise.all([
      waitFor(
        () =>
          JSON.stringify(readState(ownerConnection.doc)) ===
          JSON.stringify(initial),
        'owner restore update',
      ),
      waitFor(
        () =>
          JSON.stringify(readState(editorConnection.doc)) ===
          JSON.stringify(initial),
        'editor restore update',
      ),
    ]);

    const history = await api(owner)
      .get(`/api/diagrams/${diagram.id}/versions`)
      .expect(200)
      .then((response) => response.body);
    expect(
      history.map(
        (version: { versionNumber: number }) => version.versionNumber,
      ),
    ).toEqual([4, 3, 2, 1]);
    expect(history.map((version: { type: string }) => version.type)).toEqual([
      'restore',
      'checkpoint',
      'manual',
      'manual',
    ]);
    expect(history[1]).toMatchObject({
      content: collaborativeState.content,
      config: collaborativeState.config,
    });

    const revokedClose = terminalClose(editorConnection.provider);
    await api(owner)
      .patch(`/api/diagrams/${diagram.id}/members/${editor.user.id}`)
      .send({ role: 'viewer' })
      .expect(200);
    await expect(revokedClose).resolves.toMatchObject({ code: 4403 });
    expect(editorConnection.provider.shouldConnect).toBe(false);

    const viewerTicket = await ticket(editor, diagram.id);
    expect(viewerTicket.role).toBe('viewer');
    const viewerConnection = connect(diagram.id, viewerTicket.ticket);
    await waitFor(
      () => viewerConnection.provider.synced,
      'viewer initial sync',
    );
    expect(readState(viewerConnection.doc)).toEqual(initial);

    const viewerRejected = terminalClose(viewerConnection.provider);
    viewerConnection.doc.getText('code').insert(0, 'forbidden\n');
    await expect(viewerRejected).resolves.toMatchObject({ code: 4403 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readState(ownerConnection.doc)).toEqual(initial);
    await api(owner)
      .get(`/api/diagrams/${diagram.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.currentContent).toBe(initial.content);
        expect(response.body.currentConfig).toBe(initial.config);
      });
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

  async function ticket(
    session: Session,
    diagramId: string,
  ): Promise<CollaborationTicket> {
    return api(session)
      .post(`/api/diagrams/${diagramId}/collaboration-ticket`)
      .expect(201)
      .then((response) => response.body as CollaborationTicket);
  }

  function connect(diagramId: string, ticketValue: string) {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(
      `${wsUrl}/ws`,
      'collaboration',
      doc,
      {
        params: { diagramId, ticket: ticketValue },
        WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
        disableBc: true,
      },
    );
    documents.push(doc);
    providers.push(provider);
    return { doc, provider };
  }
});

function readState(doc: Y.Doc) {
  return {
    content: doc.getText('code').toString(),
    config: doc.getText('config').toString(),
  };
}

function hasAwareness(provider: WebsocketProvider, email: string): boolean {
  return [...provider.awareness.getStates().values()].some(
    (state) => (state.user as { email?: string } | undefined)?.email === email,
  );
}

function terminalClose(provider: WebsocketProvider, timeoutMs = 8_000) {
  return new Promise<{ code: number; reason: string }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for provider to close')),
      timeoutMs,
    );
    provider.once('closed', (event) => {
      clearTimeout(timer);
      resolve(event);
    });
  });
}

function socketClose(
  socket: WebSocket,
  description: string,
  timeoutMs = 8_000,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Timed out waiting for ${description}`));
    }, timeoutMs);
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
