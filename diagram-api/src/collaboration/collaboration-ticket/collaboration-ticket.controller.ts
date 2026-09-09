import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.types.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { ResourceRole } from '../../permissions/permission.types.js';
import { PermissionsService } from '../../permissions/permissions.service.js';
import { CollaborationTicketService } from './collaboration-ticket.service.js';

@UseGuards(JwtAuthGuard)
@Controller('diagrams/:id/collaboration-ticket')
export class CollaborationTicketController {
  constructor(
    private readonly tickets: CollaborationTicketService,
    private readonly permissions: PermissionsService,
  ) {}

  @Post()
  async create(
    @Param('id', ParseUUIDPipe) diagramId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const role = await this.permissions.requireDiagramRole(
      user.id,
      diagramId,
      ResourceRole.Viewer,
    );
    const issued = this.tickets.issue(diagramId, user.id, role);
    return {
      ...issued,
      role,
      websocketPath: '/ws/collaboration',
    };
  }
}
