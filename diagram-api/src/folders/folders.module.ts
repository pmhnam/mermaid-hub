import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { CollaborationModule } from '../collaboration/collaboration.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { Folder } from './entities/folder.entity.js';
import { FolderMember } from './entities/folder-member.entity.js';
import { User } from '../users/entities/user.entity.js';
import { FoldersService } from './folders.service.js';
import { FoldersController } from './folders.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Folder, FolderMember, User]),
    AuthModule,
    CollaborationModule,
    PermissionsModule,
  ],
  controllers: [FoldersController],
  providers: [FoldersService],
})
export class FoldersModule {}
