import type { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { PublicLink, PublicLinkMode } from './entities/public-link.entity.js';
import { PublicLinksService } from './public-links.service.js';

describe('PublicLinksService capability tokens', () => {
  const link = Object.assign(new PublicLink(), {
    id: '1a58ac20-204b-4e80-b8f7-07bfa5a25944',
    diagramId: '65b70b6d-3209-46c9-ae1d-ebf071866949',
    tokenNonce: 'a-random-persisted-nonce',
    mode: PublicLinkMode.Read,
    revokedAt: null,
    diagram: { deletedAt: null },
  });

  function service(findOne = vi.fn().mockResolvedValue(link)) {
    return new PublicLinksService(
      { findOne } as never,
      {} as never,
      {
        getOrThrow: vi.fn().mockReturnValue('x'.repeat(32)),
      } as unknown as ConfigService,
    );
  }

  it('reconstructs and resolves a signed token without persisting it', async () => {
    const findOne = vi.fn().mockResolvedValue(link);
    const links = service(findOne);
    const token = links.tokenFor(link);

    await expect(links.resolveToken(token)).resolves.toBe(link);
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: link.id,
          tokenNonce: link.tokenNonce,
        }),
      }),
    );
    expect(link).not.toHaveProperty('token');
  });

  it('rejects a modified signature before querying storage', async () => {
    const findOne = vi.fn();
    const links = service(findOne);
    const token = `${links.tokenFor(link)}x`;

    await expect(links.resolveToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findOne).not.toHaveBeenCalled();
  });
});
