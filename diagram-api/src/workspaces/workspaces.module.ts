import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { Diagram } from '../diagrams/entities/diagram.entity.js';
import { Folder } from '../folders/entities/folder.entity.js';
import { WorkspacesService } from './workspaces.service.js';
import { WorkspacesController } from './workspaces.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Folder, Diagram]), AuthModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
})
export class WorkspacesModule {}
