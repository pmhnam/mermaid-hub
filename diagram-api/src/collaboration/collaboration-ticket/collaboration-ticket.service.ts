import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { ResourceRole } from '../../permissions/permission.types.js';
import { PublicLink } from '../../public-links/entities/public-link.entity.js';
import { PublicLinksService } from '../../public-links/public-links.service.js';
import { CollaborationActor } from '../collaboration-actor.js';

export interface CollaborationTicket {
  diagramId: string;
  actor: CollaborationActor;
  role: ResourceRole;
  expiresAt: Date;
}

@Injectable()
export class CollaborationTicketService {
  private readonly tickets = new Map<string, CollaborationTicket>();

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly publicLinks?: PublicLinksService,
  ) {}

  issue(
    diagramId: string,
    userId: string,
    role: ResourceRole,
  ): { ticket: string; expiresAt: Date } {
    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() +
        this.config.get<number>('COLLABORATION_TICKET_TTL_SECONDS', 45) * 1000,
    );
    this.tickets.set(ticket, {
      diagramId,
      actor: { type: 'registered', userId },
      role,
      expiresAt,
    });
    setTimeout(
      () => this.tickets.delete(ticket),
      expiresAt.getTime() - Date.now(),
    ).unref();
    return { ticket, expiresAt };
  }

  issuePublic(
    link: PublicLink,
    role: ResourceRole,
  ): { ticket: string; expiresAt: Date; visitorId: string } {
    const ticket = randomBytes(32).toString('base64url');
    const visitorId = randomBytes(16).toString('base64url');
    const expiresAt = this.expiry();
    this.tickets.set(ticket, {
      diagramId: link.diagramId,
      actor: {
        type: 'public',
        visitorId,
        publicLinkId: link.id,
        publicLinkNonce: link.tokenNonce,
      },
      role,
      expiresAt,
    });
    this.scheduleExpiry(ticket, expiresAt);
    return { ticket, expiresAt, visitorId };
  }

  consume(ticket: string, diagramId: string): CollaborationTicket | null {
    const value = this.tickets.get(ticket);
    if (!value) return null;

    // Delete before validation so every presented ticket is single-use.
    this.tickets.delete(ticket);
    if (
      value.diagramId !== diagramId ||
      value.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }
    return value;
  }

  async revalidatePublic(ticket: CollaborationTicket): Promise<boolean> {
    if (ticket.actor.type === 'registered') return true;
    const link = await this.publicLinks?.revalidate(
      ticket.actor.publicLinkId,
      ticket.actor.publicLinkNonce,
    );
    if (!link || link.diagramId !== ticket.diagramId) return false;
    const currentRole =
      link.mode === 'public_edit' ? ResourceRole.Editor : ResourceRole.Viewer;
    return currentRole === ticket.role;
  }

  invalidatePublicLink(publicLinkId: string): void {
    for (const [value, ticket] of this.tickets) {
      if (
        ticket.actor.type === 'public' &&
        ticket.actor.publicLinkId === publicLinkId
      ) {
        this.tickets.delete(value);
      }
    }
  }

  private expiry(): Date {
    return new Date(
      Date.now() +
        this.config.get<number>('COLLABORATION_TICKET_TTL_SECONDS', 45) * 1000,
    );
  }

  private scheduleExpiry(ticket: string, expiresAt: Date): void {
    setTimeout(
      () => this.tickets.delete(ticket),
      expiresAt.getTime() - Date.now(),
    ).unref();
  }
}
