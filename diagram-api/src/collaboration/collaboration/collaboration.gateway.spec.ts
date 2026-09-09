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
});
