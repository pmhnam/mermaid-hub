import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { Diagram } from '../diagrams/entities/diagram.entity.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { DiagramVersion } from './entities/version.entity.js';
import { VersionStateProvider } from './version-state.provider.js';
import { VersionsService } from './versions.service.js';
import { VersionsController } from './versions.controller.js';
import { CollaborationModule } from '../collaboration/collaboration.module.js';
import { YdocManagerService } from '../collaboration/ydoc-manager/ydoc-manager.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Diagram, DiagramVersion]),
    AuthModule,
    PermissionsModule,
    CollaborationModule,
  ],
  controllers: [VersionsController],
  providers: [
    VersionsService,
    { provide: VersionStateProvider, useExisting: YdocManagerService },
  ],
})
export class VersionsModule {}
