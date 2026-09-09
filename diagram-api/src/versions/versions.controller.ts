import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CreateVersionDto } from './dto/create-version.dto.js';
import { VersionsService } from './versions.service.js';

@UseGuards(JwtAuthGuard)
@Controller('diagrams/:diagramId/versions')
export class VersionsController {
  constructor(private readonly versionsService: VersionsService) {}

  @Get()
  findAll(
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.versionsService.findAll(diagramId, user.id);
  }

  @Post()
  create(
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @Body() dto: CreateVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.versionsService.createManual(diagramId, user.id, dto);
  }

  @Get(':versionId')
  findOne(
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.versionsService.findOne(diagramId, versionId, user.id);
  }

  @Post(':versionId/restore')
  restore(
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.versionsService.restore(diagramId, versionId, user.id);
  }
}
