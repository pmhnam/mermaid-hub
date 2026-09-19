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
import { CommentsService } from './comments.service.js';
import { CreateCommentDto, ResolveCommentDto } from './dto/comment.dto.js';

@UseGuards(JwtAuthGuard)
@Controller('diagrams/:diagramId/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}
  @Get() list(
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comments.list(diagramId, user.id);
  }
  @Post() create(
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(diagramId, user.id, dto);
  }
  @Patch(':id') resolve(
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ResolveCommentDto,
  ) {
    return this.comments.resolve(diagramId, id, user.id, dto.resolved);
  }
  @Delete(':id') @HttpCode(204) remove(
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comments.remove(diagramId, id, user.id);
  }
}
