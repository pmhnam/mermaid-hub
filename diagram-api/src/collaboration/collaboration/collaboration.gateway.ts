import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { CollaborationTicketService } from '../collaboration-ticket/collaboration-ticket.service.js';
import { YdocManagerService } from '../ydoc-manager/ydoc-manager.service.js';

interface ConnectionContext {
  diagramId: string;
}

@WebSocketGateway({ path: '/ws/collaboration' })
export class CollaborationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CollaborationGateway.name);
  private readonly connections = new WeakMap<WebSocket, ConnectionContext>();

  constructor(
    private readonly tickets: CollaborationTicketService,
    private readonly documents: YdocManagerService,
  ) {}

  async handleConnection(
    client: WebSocket,
    request: IncomingMessage,
  ): Promise<void> {
    try {
      const url = new URL(request.url ?? '', 'http://localhost');
      const diagramId = url.searchParams.get('diagramId');
      const ticketValue = url.searchParams.get('ticket');
      if (!diagramId || !ticketValue) {
        client.close(4401, 'Missing collaboration credentials');
        return;
      }

      const ticket = this.tickets.consume(ticketValue, diagramId);
      if (
        !ticket ||
        (ticket.actor?.type === 'public' &&
          !(await this.tickets.revalidatePublic(ticket)))
      ) {
        client.close(4401, 'Invalid or expired collaboration ticket');
        return;
      }

      await this.documents.connect(
        diagramId,
        client,
        ticket.actor,
        ticket.role,
      );
      this.connections.set(client, { diagramId });
      client.on('message', (data: RawData) => {
        void this.documents.handleMessage(diagramId, client, data);
      });
    } catch (error) {
      this.logger.warn(
        `Collaboration connection rejected: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      client.close(4500, 'Unable to join collaboration room');
    }
  }

  async handleDisconnect(client: WebSocket): Promise<void> {
    const context = this.connections.get(client);
    if (!context) return;
    this.connections.delete(client);
    await this.documents.disconnect(context.diagramId, client);
  }
}
