import { Diagram } from './entities/diagram.entity.js';
import { DiagramsService } from './diagrams.service.js';

describe('DiagramsService autosave update', () => {
  it('updates current content and config without creating a version', async () => {
    const diagram = Object.assign(new Diagram(), {
      id: 'diagram-id',
      workspaceId: 'workspace-id',
      currentContent: 'old code',
      currentConfig: 'old config',
    });
    const queryBuilder = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(diagram),
    };
    const manager = {
      getRepository: vi.fn(() => ({
        createQueryBuilder: vi.fn(() => queryBuilder),
      })),
      save: vi.fn(async (_entity, value) => value),
    };
    const dataSource = {
      transaction: vi.fn(async (callback) => callback(manager)),
    };
    const permissions = {
      requireDiagramRole: vi.fn().mockResolvedValue('editor'),
    };
    const service = new DiagramsService(
      {} as never,
      {} as never,
      dataSource as never,
      permissions as never,
    );

    await service.update('diagram-id', 'user-id', {
      currentContent: 'new code',
      currentConfig: 'new config',
    });

    expect(diagram.currentContent).toBe('new code');
    expect(diagram.currentConfig).toBe('new config');
    expect(manager.save).toHaveBeenCalledOnce();
    expect(manager.save).toHaveBeenCalledWith(Diagram, diagram);
  });
});
