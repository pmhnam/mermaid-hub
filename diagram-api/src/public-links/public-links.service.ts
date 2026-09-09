import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Diagram } from '../diagrams/entities/diagram.entity.js';
import { PublicLink, PublicLinkMode } from './entities/public-link.entity.js';

@Injectable()
export class PublicLinksService {
  private readonly secret: string;

  constructor(
    @InjectRepository(PublicLink)
    private readonly links: Repository<PublicLink>,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('PUBLIC_LINK_SECRET');
  }

  async getActive(diagramId: string): Promise<PublicLink> {
    const link = await this.links.findOneBy({ diagramId, revokedAt: IsNull() });
    if (!link) throw new NotFoundException('Public link not found');
    return link;
  }

  async upsert(diagramId: string, mode: PublicLinkMode): Promise<PublicLink> {
    return this.dataSource.transaction(async (manager) => {
      const diagram = await manager
        .getRepository(Diagram)
        .createQueryBuilder('diagram')
        .setLock('pessimistic_write')
        .where('diagram.id = :diagramId', { diagramId })
        .getOne();
      if (!diagram) throw new NotFoundException('Diagram not found');
      const repository = manager.getRepository(PublicLink);
      const link = await repository.findOneBy({
        diagramId,
        revokedAt: IsNull(),
      });
      if (link) {
        link.mode = mode;
        return repository.save(link);
      }
      return repository.save(
        repository.create({
          diagramId,
          mode,
          tokenNonce: randomBytes(24).toString('base64url'),
          revokedAt: null,
        }),
      );
    });
  }

  async revoke(diagramId: string): Promise<PublicLink> {
    const link = await this.getActive(diagramId);
    link.revokedAt = new Date();
    return this.links.save(link);
  }

  async rotate(diagramId: string): Promise<PublicLink> {
    const link = await this.getActive(diagramId);
    link.tokenNonce = randomBytes(24).toString('base64url');
    return this.links.save(link);
  }

  tokenFor(link: PublicLink): string {
    const capability = `${link.id}.${link.tokenNonce}`;
    return `${capability}.${this.sign(capability)}`;
  }

  async resolveToken(token: string): Promise<PublicLink> {
    const [id, nonce, signature, extra] = token.split('.');
    if (!id || !nonce || !signature || extra) this.unauthorized();
    const capability = `${id}.${nonce}`;
    const expected = Buffer.from(this.sign(capability));
    const actual = Buffer.from(signature);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      this.unauthorized();
    }
    const link = await this.links.findOne({
      where: { id, tokenNonce: nonce, revokedAt: IsNull() },
      relations: { diagram: true },
    });
    if (!link?.diagram || link.diagram.deletedAt) this.unauthorized();
    return link;
  }

  async revalidate(id: string, nonce: string): Promise<PublicLink | null> {
    return this.links.findOneBy({ id, tokenNonce: nonce, revokedAt: IsNull() });
  }

  private sign(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private unauthorized(): never {
    throw new UnauthorizedException('Invalid public diagram link');
  }
}
