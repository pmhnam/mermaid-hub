import type { ConfigService } from '@nestjs/config';
import { ResourceRole } from '../../permissions/permission.types.js';
import { CollaborationTicketService } from './collaboration-ticket.service.js';

describe('CollaborationTicketService', () => {
  const config = {
    get: vi.fn((_key: string, fallback: number) => fallback),
  } as unknown as ConfigService;

  it('issues a scoped ticket and consumes it only once', () => {
    const service = new CollaborationTicketService(config);
    const issued = service.issue('diagram-1', 'user-1', ResourceRole.Editor);

    expect(service.consume(issued.ticket, 'diagram-1')).toMatchObject({
      diagramId: 'diagram-1',
      actor: { type: 'registered', userId: 'user-1' },
      role: ResourceRole.Editor,
    });
    expect(service.consume(issued.ticket, 'diagram-1')).toBeNull();
  });

  it('invalidates a ticket presented for the wrong diagram', () => {
    const service = new CollaborationTicketService(config);
    const { ticket } = service.issue(
      'diagram-1',
      'user-1',
      ResourceRole.Viewer,
    );

    expect(service.consume(ticket, 'diagram-2')).toBeNull();
    expect(service.consume(ticket, 'diagram-1')).toBeNull();
  });

  it('rejects an expired ticket', () => {
    vi.useFakeTimers();
    try {
      const service = new CollaborationTicketService(config);
      const { ticket } = service.issue(
        'diagram-1',
        'user-1',
        ResourceRole.Owner,
      );
      vi.advanceTimersByTime(45_001);

      expect(service.consume(ticket, 'diagram-1')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('revalidates and invalidates public-link tickets', async () => {
    const publicLinks = {
      revalidate: vi.fn().mockResolvedValue({
        id: 'link-1',
        diagramId: 'diagram-1',
        mode: 'public_edit',
      }),
    };
    const service = new CollaborationTicketService(
      config,
      publicLinks as never,
    );
    const issued = service.issuePublic(
      {
        id: 'link-1',
        diagramId: 'diagram-1',
        tokenNonce: 'nonce-1',
      } as never,
      ResourceRole.Editor,
    );
    const ticket = service.consume(issued.ticket, 'diagram-1')!;

    await expect(service.revalidatePublic(ticket)).resolves.toBe(true);
    expect(ticket.actor).toMatchObject({
      type: 'public',
      publicLinkId: 'link-1',
      visitorId: issued.visitorId,
    });

    const pending = service.issuePublic(
      {
        id: 'link-1',
        diagramId: 'diagram-1',
        tokenNonce: 'nonce-1',
      } as never,
      ResourceRole.Editor,
    );
    service.invalidatePublicLink('link-1');
    expect(service.consume(pending.ticket, 'diagram-1')).toBeNull();
  });
});
