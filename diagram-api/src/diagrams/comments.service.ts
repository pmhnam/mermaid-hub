import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ResourceRole } from '../permissions/permission.types.js';
import { DiagramComment } from './entities/diagram-comment.entity.js';
import type { CreateCommentDto } from './dto/comment.dto.js';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(DiagramComment)
    private readonly comments: Repository<DiagramComment>,
    private readonly permissions: PermissionsService,
  ) {}
  async list(diagramId: string, userId: string) {
    await this.permissions.requireDiagramRole(
      userId,
      diagramId,
      ResourceRole.Viewer,
    );
    const comments = await this.comments.find({
      where: { diagramId },
      relations: { author: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 100,
    });
    return comments.map((comment) => ({
      id: comment.id,
      authorId: comment.authorId,
      authorName: comment.author?.displayName ?? 'Former member',
      body: comment.body,
      target: comment.target,
      resolved: comment.resolved,
      createdAt: comment.createdAt,
    }));
  }
  async create(diagramId: string, userId: string, input: CreateCommentDto) {
    await this.permissions.requireDiagramRole(
      userId,
      diagramId,
      ResourceRole.Viewer,
    );
    const saved = await this.comments.save(
      this.comments.create({
        diagramId,
        authorId: userId,
        body: input.body.trim(),
        target: input.target?.trim() || null,
      }),
    );
    return { id: saved.id };
  }
  private async editable(diagramId: string, id: string, userId: string) {
    const role = await this.permissions.requireDiagramRole(
      userId,
      diagramId,
      ResourceRole.Viewer,
    );
    const comment = await this.comments.findOneBy({ id, diagramId });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId && role !== ResourceRole.Owner)
      throw new ForbiddenException(
        'Only the author or diagram owner can change this comment',
      );
    return comment;
  }
  async resolve(
    diagramId: string,
    id: string,
    userId: string,
    resolved: boolean,
  ) {
    const comment = await this.editable(diagramId, id, userId);
    await this.comments.update(comment.id, { resolved });
    return { id, resolved };
  }
  async remove(diagramId: string, id: string, userId: string) {
    const comment = await this.editable(diagramId, id, userId);
    await this.comments.delete(comment.id);
  }
}
