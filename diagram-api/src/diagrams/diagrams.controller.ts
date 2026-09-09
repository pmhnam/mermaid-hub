import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { DiagramsService } from './diagrams.service.js';
import { CreateDiagramDto } from './dto/create-diagram.dto.js';
import { UpdateDiagramDto } from './dto/update-diagram.dto.js';

@UseGuards(JwtAuthGuard)
@Controller()
export class DiagramsController {
  constructor(private readonly diagramsService: DiagramsService) {}

  @Post('workspaces/:workspaceId/diagrams')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateDiagramDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.diagramsService.create(workspaceId, user.id, dto);
  }

  @Get('diagrams/:id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.diagramsService.findOne(id, user.id);
  }

  @Patch('diagrams/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiagramDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.diagramsService.update(id, user.id, dto);
  }

  @Delete('diagrams/:id')
  @HttpCode(204)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.diagramsService.remove(id, user.id);
  }

  @Post('diagrams/:id/members')
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.diagramsService.addMember(id, user.id, dto);
  }

  @Get('diagrams/:id/members')
  findMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.diagramsService.findMembers(id, user.id);
  }

  @Patch('diagrams/:id/members/:userId')
  updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.diagramsService.updateMember(id, memberUserId, user.id, dto);
  }

  @Delete('diagrams/:id/members/:userId')
  @HttpCode(204)
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.diagramsService.removeMember(id, memberUserId, user.id);
  }
}
