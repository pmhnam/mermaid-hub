import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { Diagram } from '../diagrams/entities/diagram.entity.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { CollaborationGateway } from './collaboration/collaboration.gateway.js';
import { CollaborationTicketController } from './collaboration-ticket/collaboration-ticket.controller.js';
import { CollaborationTicketService } from './collaboration-ticket/collaboration-ticket.service.js';
import { YdocManagerService } from './ydoc-manager/ydoc-manager.service.js';
import { PublicLinksModule } from '../public-links/public-links.module.js';
import {
  PublicDiagramController,
  PublicLinkManagementController,
} from '../public-links/public-links.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Diagram]),
    AuthModule,
    PermissionsModule,
    PublicLinksModule,
  ],
  controllers: [
    CollaborationTicketController,
    PublicLinkManagementController,
    PublicDiagramController,
  ],
  providers: [
    CollaborationGateway,
    CollaborationTicketService,
    YdocManagerService,
  ],
  exports: [CollaborationTicketService, YdocManagerService],
})
export class CollaborationModule {}
