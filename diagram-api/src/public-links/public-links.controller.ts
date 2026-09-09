import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CollaborationTicketService } from '../collaboration/collaboration-ticket/collaboration-ticket.service.js';
import { YdocManagerService } from '../collaboration/ydoc-manager/ydoc-manager.service.js';
import { ResourceRole } from '../permissions/permission.types.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { UpsertPublicLinkDto } from './dto/upsert-public-link.dto.js';
import { PublicLink, PublicLinkMode } from './entities/public-link.entity.js';
import { PublicLinksService } from './public-links.service.js';

@UseGuards(JwtAuthGuard)
@Controller('diagrams/:id/public-link')
export class PublicLinkManagementController {
  constructor(
    private readonly links: PublicLinksService,
    private readonly permissions: PermissionsService,
    private readonly tickets: CollaborationTicketService,
    private readonly documents: YdocManagerService,
  ) {}

  @Get()
  async get(
    @Param('id', ParseUUIDPipe) diagramId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwner(user.id, diagramId);
    return this.response(await this.links.getActive(diagramId));
  }

  @Put()
  async upsert(
    @Param('id', ParseUUIDPipe) diagramId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertPublicLinkDto,
  ) {
    await this.requireOwner(user.id, diagramId);
    const link = await this.links.upsert(diagramId, dto.mode);
    this.invalidate(link.id);
    return this.response(link);
  }

  @Delete()
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) diagramId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.requireOwner(user.id, diagramId);
    const link = await this.links.revoke(diagramId);
    this.invalidate(link.id);
  }

  @Post('rotate')
  async rotate(
    @Param('id', ParseUUIDPipe) diagramId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.requireOwner(user.id, diagramId);
    const link = await this.links.rotate(diagramId);
    this.invalidate(link.id);
    return this.response(link);
  }

  private requireOwner(userId: string, diagramId: string) {
    return this.permissions.requireDiagramRole(
      userId,
      diagramId,
      ResourceRole.Owner,
    );
  }

  private invalidate(publicLinkId: string): void {
    this.tickets.invalidatePublicLink(publicLinkId);
    this.documents.disconnectPublicLink(publicLinkId);
  }

  private response(link: PublicLink) {
    return {
      diagramId: link.diagramId,
      mode: link.mode,
      shareToken: this.links.tokenFor(link),
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };
  }
}

@Controller('public/diagram')
export class PublicDiagramController {
  constructor(
    private readonly links: PublicLinksService,
    private readonly tickets: CollaborationTicketService,
    private readonly documents: YdocManagerService,
  ) {}

  @Get()
  async get(@Headers('authorization') authorization?: string) {
    const link = await this.resolve(authorization);
    const state = await this.documents.getAuthoritativeState(link.diagram);
    return {
      id: link.diagram.id,
      title: link.diagram.title,
      currentContent: state.content,
      currentConfig: state.config,
      mode: link.mode,
      updatedAt: link.diagram.updatedAt,
    };
  }

  @Post('collaboration-ticket')
  async ticket(@Headers('authorization') authorization?: string) {
    const link = await this.resolve(authorization);
    const role =
      link.mode === PublicLinkMode.Edit
        ? ResourceRole.Editor
        : ResourceRole.Viewer;
    const issued = this.tickets.issuePublic(link, role);
    return {
      ...issued,
      role,
      websocketPath: '/ws/collaboration',
    };
  }

  private resolve(authorization?: string) {
    const match = /^DiagramLink (\S+)$/.exec(authorization ?? '');
    if (!match) {
      throw new UnauthorizedException('DiagramLink authorization required');
    }
    return this.links.resolveToken(match[1]);
  }
}
