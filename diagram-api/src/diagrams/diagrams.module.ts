import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { Folder } from '../folders/entities/folder.entity.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { User } from '../users/entities/user.entity.js';
import { DiagramMember } from './entities/diagram-member.entity.js';
import { Diagram } from './entities/diagram.entity.js';
import { DiagramsService } from './diagrams.service.js';
import { DiagramsController } from './diagrams.controller.js';
import { CollaborationModule } from '../collaboration/collaboration.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Diagram, Folder, DiagramMember, User]),
    AuthModule,
    PermissionsModule,
    CollaborationModule,
  ],
  controllers: [DiagramsController],
  providers: [DiagramsService],
})
export class DiagramsModule {}
