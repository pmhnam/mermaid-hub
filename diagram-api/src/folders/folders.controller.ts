import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AddMemberDto } from '../common/dto/add-member.dto.js';
import { UpdateMemberDto } from '../common/dto/update-member.dto.js';
import { FoldersService } from './folders.service.js';
import { CreateFolderDto } from './dto/create-folder.dto.js';
import { UpdateFolderDto } from './dto/update-folder.dto.js';

@UseGuards(JwtAuthGuard)
@Controller()
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Post('workspaces/:workspaceId/folders')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateFolderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.foldersService.create(workspaceId, user.id, dto);
  }

  @Patch('folders/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFolderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.foldersService.update(id, user.id, dto);
  }

  @Delete('folders/:id')
  @HttpCode(204)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.foldersService.remove(id, user.id);
  }

  @Post('folders/:id/members')
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.foldersService.addMember(id, user.id, dto);
  }

  @Get('folders/:id/members')
  findMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.foldersService.findMembers(id, user.id);
  }

  @Patch('folders/:id/members/:userId')
  updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.foldersService.updateMember(id, memberUserId, user.id, dto);
  }

  @Delete('folders/:id/members/:userId')
  @HttpCode(204)
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.foldersService.removeMember(id, memberUserId, user.id);
  }
}
