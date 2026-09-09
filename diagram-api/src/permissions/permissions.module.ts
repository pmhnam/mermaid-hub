import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity.js';
import { PermissionsService } from './permissions.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceMember])],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
