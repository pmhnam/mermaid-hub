import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';

interface Session {
  accessToken: string;
  user: { id: string };
}

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;

databaseDescribe('Anonymous public diagram sharing (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    process.env.PUBLIC_LINK_SECRET ??=
      'public-link-test-secret-at-least-32-chars';
    const { AppModule } = await import('../src/app.module.js');
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(() => app?.close());

  it('manages, reads, edits, and rotates an owner-scoped public link', async () => {
    const suffix = `${Date.now()}-${crypto.randomUUID()}`;
    const owner = await register(`public-owner-${suffix}@example.test`);
    const other = await register(`public-other-${suffix}@example.test`);
    const workspace = await api(owner)
      .get('/api/workspaces')
      .expect(200)
      .then((response) => response.body[0]);
    const diagram = await api(owner)
      .post(`/api/workspaces/${workspace.id}/diagrams`)
      .send({ title: 'Shared diagram', currentContent: 'graph TD\n A-->B' })
      .expect(201)
      .then((response) => response.body);

    await api(other).get(`/api/diagrams/${diagram.id}/public-link`).expect(403);
    const readLink = await api(owner)
      .put(`/api/diagrams/${diagram.id}/public-link`)
      .send({ mode: 'public_read' })
      .expect(200)
      .then((response) => response.body);
    expect(Object.keys(readLink).sort()).toEqual(
      ['createdAt', 'diagramId', 'mode', 'shareToken', 'updatedAt'].sort(),
    );

    await request(server)
      .get('/api/public/diagram')
      .set('Authorization', `DiagramLink ${readLink.shareToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            id: diagram.id,
            title: 'Shared diagram',
            currentContent: 'graph TD\n A-->B',
            currentConfig: '',
            mode: 'public_read',
          }),
        );
        expect(response.body).not.toHaveProperty('ownerId');
        expect(response.body).not.toHaveProperty('workspaceId');
      });
    await publicTicket(readLink.shareToken)
      .expect(201)
      .expect((response) => {
        expect(response.body.role).toBe('viewer');
        expect(response.body.visitorId).toEqual(expect.any(String));
      });

    const editLink = await api(owner)
      .put(`/api/diagrams/${diagram.id}/public-link`)
      .send({ mode: 'public_edit' })
      .expect(200)
      .then((response) => response.body);
    expect(editLink.shareToken).toBe(readLink.shareToken);
    await publicTicket(editLink.shareToken)
      .expect(201)
      .expect((response) => {
        expect(response.body.role).toBe('editor');
      });

    const rotated = await api(owner)
      .post(`/api/diagrams/${diagram.id}/public-link/rotate`)
      .expect(201)
      .then((response) => response.body);
    expect(rotated.shareToken).not.toBe(editLink.shareToken);
    await publicTicket(editLink.shareToken).expect(401);
    await publicTicket(rotated.shareToken).expect(201);

    await api(owner)
      .delete(`/api/diagrams/${diagram.id}/public-link`)
      .expect(204);
    await publicTicket(rotated.shareToken).expect(401);
  });

  function api(session: Session) {
    return request
      .agent(server)
      .set('Authorization', `Bearer ${session.accessToken}`);
  }

  function publicTicket(token: string) {
    return request(server)
      .post('/api/public/diagram/collaboration-ticket')
      .set('Authorization', `DiagramLink ${token}`);
  }

  function register(email: string): Promise<Session> {
    return request(server)
      .post('/api/auth/register')
      .send({
        email,
        displayName: email.split('@')[0],
        password: 'correct-horse-battery-staple',
      })
      .expect(201)
      .then((response) => response.body as Session);
  }
});
