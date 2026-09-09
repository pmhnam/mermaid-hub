import { Diagram } from '../diagrams/entities/diagram.entity.js';
import { ResourceRole } from '../permissions/permission.types.js';
import { DiagramVersion, VersionType } from './entities/version.entity.js';
import { VersionStateProvider } from './version-state.provider.js';
import { applyDocumentState, VersionsService } from './versions.service.js';
import { nextVersionNumber } from './version-persistence.js';

describe('version transaction helpers', () => {
  it('allocates monotonically increasing version numbers from the locked row', () => {
    const diagram = Object.assign(new Diagram(), { versionSeq: 7 });

    expect(nextVersionNumber(diagram)).toBe(8);
    expect(nextVersionNumber(diagram)).toBe(9);
    expect(diagram.versionSeq).toBe(9);
  });

  it('applies restored text state and invalidates the persisted Yjs snapshot', () => {
    const diagram = Object.assign(new Diagram(), {
      currentContent: 'current',
      currentConfig: 'current config',
      yjsState: Buffer.from('stale'),
    });

    applyDocumentState(diagram, {
      content: 'restored',
      config: 'restored config',
    });

    expect(diagram.currentContent).toBe('restored');
    expect(diagram.currentConfig).toBe('restored config');
    expect(diagram.yjsState).toBeNull();
  });

  it('resets the checkpoint boundary after a successful manual version', async () => {
    const diagram = Object.assign(new Diagram(), {
      id: 'diagram-id',
      versionSeq: 0,
      currentContent: 'live',
      currentConfig: '',
    });
    const query = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(diagram),
    };
    const manager = {
      getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => query) })),
      create: vi.fn((entity, values) => Object.assign(new entity(), values)),
      save: vi.fn(async (entity, value) => {
        if (entity === DiagramVersion) value.id = 'manual-version';
        return value;
      }),
    };
    const stateProvider = {
      runExclusive: vi.fn(async (_id, operation) => operation()),
      getAuthoritativeState: vi.fn().mockResolvedValue({
        content: 'active state',
        config: 'active config',
      }),
      resetCheckpointState: vi.fn(),
    };
    const service = new VersionsService(
      {} as never,
      {
        getRepository: vi.fn(() => ({
          existsBy: vi.fn().mockResolvedValue(true),
        })),
        transaction: vi.fn(async (operation) => operation(manager)),
      } as never,
      { requireDiagramRole: vi.fn() } as never,
      stateProvider as never,
    );

    const version = await service.createManual(diagram.id, 'user-id', {
      message: ' Saved ',
    });

    expect(version).toMatchObject({
      versionNumber: 1,
      type: VersionType.Manual,
      message: 'Saved',
      content: 'active state',
    });
    expect(stateProvider.runExclusive).toHaveBeenCalled();
    expect(stateProvider.resetCheckpointState).toHaveBeenCalledWith(diagram.id);
  });

  it('creates a checkpoint and restore version with consecutive numbers', async () => {
    const diagram = Object.assign(new Diagram(), {
      id: 'diagram-id',
      versionSeq: 4,
      currentContent: 'before',
      currentConfig: 'before config',
      yjsState: null,
    });
    const target = Object.assign(new DiagramVersion(), {
      id: 'target-id',
      diagramId: diagram.id,
      versionNumber: 2,
      content: 'target',
      config: 'target config',
    });
    const diagramQuery = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(diagram),
    };
    const versionQuery = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(target),
    };
    let inserted = 0;
    const manager = {
      getRepository: vi.fn((entity) => ({
        createQueryBuilder: vi.fn(() =>
          entity === Diagram ? diagramQuery : versionQuery,
        ),
      })),
      create: vi.fn((entity, values) => Object.assign(new entity(), values)),
      save: vi.fn(async (entity, value) => {
        if (entity === DiagramVersion) value.id = `new-version-${++inserted}`;
        return value;
      }),
    };
    const dataSource = {
      getRepository: vi.fn(() => ({
        existsBy: vi.fn().mockResolvedValue(true),
      })),
      transaction: vi.fn(async (callback) => callback(manager)),
    };
    const permissions = {
      requireDiagramRole: vi.fn().mockResolvedValue(ResourceRole.Owner),
    };
    const service = new VersionsService(
      {} as never,
      dataSource as never,
      permissions as never,
      new VersionStateProvider(),
    );

    const restored = await service.restore(diagram.id, target.id, 'user-id');

    const versionSaves = manager.save.mock.calls
      .filter(([entity]) => entity === DiagramVersion)
      .map(([, version]) => version);
    expect(versionSaves).toMatchObject([
      { versionNumber: 5, type: VersionType.Checkpoint, content: 'before' },
      { versionNumber: 6, type: VersionType.Restore, content: 'target' },
    ]);
    expect(restored.versionNumber).toBe(6);
    expect(diagram.currentVersionId).toBe('new-version-2');
    expect(diagram.currentContent).toBe('target');
    expect(diagram.currentConfig).toBe('target config');
    expect(versionQuery.setLock).toHaveBeenCalledWith('pessimistic_read');
  });

  it('serializes and replaces state when restoring an active room', async () => {
    const diagram = Object.assign(new Diagram(), {
      id: 'diagram-id',
      versionSeq: 0,
      currentContent: 'database state',
      currentConfig: '',
      yjsState: null,
    });
    const target = Object.assign(new DiagramVersion(), {
      id: 'target-id',
      diagramId: diagram.id,
      versionNumber: 1,
      content: 'restored',
      config: 'restored config',
    });
    const query = (value: unknown) => ({
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(value),
    });
    const manager = {
      getRepository: vi.fn((entity) => ({
        createQueryBuilder: vi.fn(() =>
          entity === Diagram ? query(diagram) : query(target),
        ),
      })),
      create: vi.fn((entity, values) => Object.assign(new entity(), values)),
      save: vi.fn(async (entity, value) => {
        if (entity === DiagramVersion) value.id = crypto.randomUUID();
        return value;
      }),
    };
    const stateProvider = {
      getAuthoritativeState: vi.fn().mockResolvedValue({
        content: 'live state',
        config: 'live config',
      }),
      runExclusive: vi.fn(async (_id, operation) => operation()),
      replaceActiveState: vi.fn().mockResolvedValue(undefined),
      resetCheckpointState: vi.fn(),
    };
    const service = new VersionsService(
      {} as never,
      {
        getRepository: vi.fn(() => ({
          existsBy: vi.fn().mockResolvedValue(true),
        })),
        transaction: vi.fn(async (operation) => operation(manager)),
      } as never,
      { requireDiagramRole: vi.fn() } as never,
      stateProvider as never,
    );

    await service.restore(diagram.id, target.id, 'user-id');

    expect(stateProvider.runExclusive).toHaveBeenCalledWith(
      diagram.id,
      expect.any(Function),
    );
    expect(stateProvider.replaceActiveState).toHaveBeenCalledWith(diagram.id, {
      content: 'restored',
      config: 'restored config',
    });
    expect(stateProvider.resetCheckpointState).toHaveBeenCalledWith(diagram.id);
    expect(manager.save.mock.calls[0][1]).toMatchObject({
      type: VersionType.Checkpoint,
      content: 'live state',
    });
  });
});
