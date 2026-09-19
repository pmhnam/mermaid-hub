import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { DiagramComment } from './entities/diagram-comment.entity.js';
import type { PermissionsService } from '../permissions/permissions.service.js';
import { ResourceRole } from '../permissions/permission.types.js';
import { CommentsService } from './comments.service.js';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCommentDto } from './dto/comment.dto.js';

const setup = (role: ResourceRole = ResourceRole.Viewer) => {
  const repository = {
    find: vi.fn().mockResolvedValue([]),
    findOneBy: vi.fn().mockResolvedValue({ id: 'comment', authorId: 'author' }),
    update: vi.fn(),
    delete: vi.fn(),
    create: vi.fn((input) => input),
    save: vi.fn().mockResolvedValue({ id: 'created' }),
  };
  const permissions = { requireDiagramRole: vi.fn().mockResolvedValue(role) };
  return {
    repository,
    permissions,
    service: new CommentsService(
      repository as unknown as Repository<DiagramComment>,
      permissions as unknown as PermissionsService,
    ),
  };
};
describe('diagram comments access', () => {
  it('denies listing and posting after diagram access is revoked', async () => {
    const { service, permissions, repository } = setup();
    permissions.requireDiagramRole.mockRejectedValue(new ForbiddenException());
    await expect(service.list('diagram', 'stranger')).rejects.toThrow();
    await expect(
      service.create('diagram', 'stranger', { body: 'hello' }),
    ).rejects.toThrow();
    expect(repository.find).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
  it('does not let another viewer or editor delete someone else’s comments', async () => {
    for (const role of [ResourceRole.Viewer, ResourceRole.Editor]) {
      const { service, repository } = setup(role);
      await expect(
        service.remove('diagram', 'comment', 'other'),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.delete).not.toHaveBeenCalled();
    }
  });
  it('scopes comment lookup to the diagram and allows the author to resolve', async () => {
    const { service, repository } = setup();
    await service.resolve('diagram', 'comment', 'author', true);
    expect(repository.findOneBy).toHaveBeenCalledWith({
      diagramId: 'diagram',
      id: 'comment',
    });
    expect(repository.update).toHaveBeenCalledWith('comment', {
      resolved: true,
    });
  });
  it('allows an owner to remove a comment', async () => {
    const { service, repository } = setup(ResourceRole.Owner);
    await service.remove('diagram', 'comment', 'owner');
    expect(repository.delete).toHaveBeenCalledWith('comment');
  });
  it('rejects whitespace and oversized comments', async () => {
    for (const body of ['    ', 'x'.repeat(4001)])
      expect(
        (await validate(plainToInstance(CreateCommentDto, { body }))).length,
      ).toBeGreaterThan(0);
  });
});
