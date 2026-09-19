import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { ResourceRole } from '../../permissions/permission.types.js';
import { CollaborationGateway } from './collaboration.gateway.js';

describe('CollaborationGateway', () => {
  it('atomically consumes a diagram-scoped ticket before joining', async () => {
    const tickets = {
      consume: vi.fn().mockReturnValue({
        diagramId: 'diagram-1',
        actor: { type: 'registered', userId: 'user-1' },
        role: ResourceRole.Editor,
      }),
    };
    const documents = {
      connect: vi.fn().mockResolvedValue(undefined),
      handleMessage: vi.fn(),
      disconnect: vi.fn(),
    };
    const gateway = new CollaborationGateway(
      tickets as never,
      documents as never,
    );
    const socket = {
      close: vi.fn(),
      on: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    } as unknown as WebSocket;
    const request = {
      url: '/ws/collaboration?diagramId=diagram-1&ticket=opaque',
    } as IncomingMessage;

    await gateway.handleConnection(socket, request);

    expect(tickets.consume).toHaveBeenCalledWith('opaque', 'diagram-1');
    expect(documents.connect).toHaveBeenCalledWith(
      'diagram-1',
      socket,
      { type: 'registered', userId: 'user-1' },
      ResourceRole.Editor,
    );
  });
  it('installs the message listener before resuming a slowly initialized room', async () => {
    let ready: () => void = () => undefined;
    const initialized = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const tickets = {
      consume: vi
        .fn()
        .mockReturnValue({
          actor: { type: 'registered', userId: 'user-1' },
          role: ResourceRole.Editor,
        }),
    };
    const documents = {
      connect: vi.fn(() => initialized),
      handleMessage: vi.fn(),
      disconnect: vi.fn(),
    };
    let receive: ((data: Buffer) => void) | undefined;
    const firstFrame = Buffer.from([0, 0, 0]);
    const socket = {
      close: vi.fn(),
      pause: vi.fn(),
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === 'message') receive = handler;
      }),
      resume: vi.fn(() => {
        receive?.(firstFrame);
      }),
    };
    const gateway = new CollaborationGateway(
      tickets as never,
      documents as never,
    );
    const connection = gateway.handleConnection(
      socket as unknown as WebSocket,
      {
        url: '/ws/collaboration?diagramId=diagram-1&ticket=opaque',
      } as IncomingMessage,
    );
    expect(socket.pause).toHaveBeenCalledOnce();
    expect(socket.resume).not.toHaveBeenCalled();
    expect(documents.handleMessage).not.toHaveBeenCalled();
    ready();
    await connection;
    expect(socket.resume).toHaveBeenCalledOnce();
    expect(documents.handleMessage).toHaveBeenCalledWith(
      'diagram-1',
      socket,
      firstFrame,
    );
  });
  it('resumes a rejected socket so its close handshake can finish', async () => {
    const socket = { pause: vi.fn(), resume: vi.fn(), close: vi.fn() };
    const gateway = new CollaborationGateway({} as never, {} as never);
    await gateway.handleConnection(
      socket as unknown as WebSocket,
      { url: '/ws/collaboration' } as IncomingMessage,
    );
    expect(socket.close).toHaveBeenCalledWith(
      4401,
      'Missing collaboration credentials',
    );
    expect(socket.resume).toHaveBeenCalledOnce();
  });
});
