import type { ConfigService } from '@nestjs/config';
import type { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { Diagram } from '../../diagrams/entities/diagram.entity.js';
import { ResourceRole } from '../../permissions/permission.types.js';
import {
  canApplySyncMessage,
  createDocumentFromDiagram,
  readDocumentState,
  replaceDocumentState,
  YdocManagerService,
} from './ydoc-manager.service.js';

function client(): WebSocket {
  return {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

describe('Y.Doc helpers', () => {
  it('initializes code and config from text when no Yjs snapshot exists', () => {
    const doc = createDocumentFromDiagram({
      currentContent: 'graph TD',
      currentConfig: '{"theme":"dark"}',
      yjsState: null,
    });

    expect(readDocumentState(doc)).toEqual({
      content: 'graph TD',
      config: '{"theme":"dark"}',
    });
  });

  it('loads persisted Yjs state and replaces both shared texts atomically', () => {
    const original = new Y.Doc();
    original.getText('code').insert(0, 'persisted');
    original.getText('config').insert(0, 'old config');
    const doc = createDocumentFromDiagram({
      currentContent: 'stale',
      currentConfig: 'stale',
      yjsState: Buffer.from(Y.encodeStateAsUpdate(original)),
    });

    replaceDocumentState(doc, { content: 'restored', config: 'new config' });
    expect(readDocumentState(doc)).toEqual({
      content: 'restored',
      config: 'new config',
    });
  });

  it('allows viewers to request sync but rejects client document updates', () => {
    expect(canApplySyncMessage(ResourceRole.Viewer, 0)).toBe(true);
    expect(canApplySyncMessage(ResourceRole.Viewer, 1)).toBe(false);
    expect(canApplySyncMessage(ResourceRole.Viewer, 2)).toBe(false);
    expect(canApplySyncMessage(ResourceRole.Editor, 2)).toBe(true);
  });
});

describe('YdocManagerService lifecycle', () => {
  it('deduplicates concurrent room loading and persists on last disconnect', async () => {
    const diagram = Object.assign(new Diagram(), {
      id: 'diagram-1',
      currentContent: 'graph TD',
      currentConfig: '',
      yjsState: null,
    });
    const repository = {
      findOneBy: vi.fn().mockResolvedValue(diagram),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const config = {
      get: vi.fn((_key: string, fallback: number) => fallback),
    } as unknown as ConfigService;
    const manager = new YdocManagerService(
      repository as never,
      {} as never,
      config,
    );
    const first = client();
    const second = client();

    await Promise.all([
      manager.connect('diagram-1', first, 'user-1', ResourceRole.Editor),
      manager.connect('diagram-1', second, 'user-2', ResourceRole.Viewer),
    ]);
    expect(repository.findOneBy).toHaveBeenCalledTimes(1);
    expect(manager.isRoomActive('diagram-1')).toBe(true);

    await manager.disconnect('diagram-1', first);
    expect(repository.update).not.toHaveBeenCalled();
    await manager.disconnect('diagram-1', second);
    expect(repository.update).toHaveBeenCalledWith(
      'diagram-1',
      expect.objectContaining({
        currentContent: 'graph TD',
        currentConfig: '',
        yjsState: expect.any(Buffer),
      }),
    );
    expect(manager.isRoomActive('diagram-1')).toBe(false);
    await manager.onApplicationShutdown();
  });

  it('disconnects a user from every affected active room', async () => {
    const repository = {
      findOneBy: vi.fn(({ id }: { id: string }) =>
        Promise.resolve(
          Object.assign(new Diagram(), {
            id,
            currentContent: '',
            currentConfig: '',
            yjsState: null,
          }),
        ),
      ),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const config = {
      get: vi.fn((_key: string, fallback: number) => fallback),
    } as unknown as ConfigService;
    const manager = new YdocManagerService(
      repository as never,
      {} as never,
      config,
    );
    const first = client();
    const second = client();

    await manager.connect('diagram-1', first, 'user-1', ResourceRole.Editor);
    await manager.connect('diagram-2', second, 'user-1', ResourceRole.Editor);
    manager.disconnectUserFromDiagrams(
      ['diagram-1', 'diagram-2', 'inactive'],
      'user-1',
    );

    expect(first.close).toHaveBeenCalledWith(
      4403,
      'Diagram permission changed',
    );
    expect(second.close).toHaveBeenCalledWith(
      4403,
      'Diagram permission changed',
    );
    await manager.onApplicationShutdown();
  });

  it('creates at most one checkpoint per interval while autosaves create none', async () => {
    vi.useFakeTimers();
    const diagram = Object.assign(new Diagram(), {
      id: 'diagram-1',
      ownerId: 'owner-1',
      versionSeq: 0,
      currentContent: '',
      currentConfig: '',
      yjsState: null,
    });
    const repository = {
      findOneBy: vi.fn().mockResolvedValue(diagram),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const versionSaves: unknown[] = [];
    const diagramQuery = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(diagram),
    };
    const transactionManager = {
      getRepository: vi.fn(() => ({
        createQueryBuilder: vi.fn(() => diagramQuery),
      })),
      create: vi.fn((entity, values) => Object.assign(new entity(), values)),
      save: vi.fn(async (entity, value) => {
        if (entity.name === 'DiagramVersion') {
          value.id = `version-${versionSaves.length + 1}`;
          versionSaves.push(value);
        }
        return value;
      }),
    };
    const dataSource = {
      transaction: vi.fn(async (operation) => operation(transactionManager)),
    };
    const config = {
      get: vi.fn((key: string, fallback: number) => {
        if (key === 'COLLABORATION_SAVE_DEBOUNCE_MS') return 10;
        if (key === 'COLLABORATION_CHECKPOINT_INTERVAL_MS') return 100;
        return fallback;
      }),
    } as unknown as ConfigService;
    const manager = new YdocManagerService(
      repository as never,
      dataSource as never,
      config,
    );
    const socket = client();
    const source = new Y.Doc();

    await manager.connect(diagram.id, socket, 'editor-1', ResourceRole.Editor);
    for (let index = 0; index < 20; index += 1) {
      source.getText('code').insert(index, 'x');
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(source));
      await manager.handleMessage(
        diagram.id,
        socket,
        Buffer.from(encoding.toUint8Array(encoder)),
      );
    }

    await vi.advanceTimersByTimeAsync(10);
    expect(repository.update).toHaveBeenCalledOnce();
    expect(versionSaves).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(90);
    expect(versionSaves).toHaveLength(1);
    expect(versionSaves[0]).toMatchObject({
      versionNumber: 1,
      type: 'checkpoint',
      createdById: 'editor-1',
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(versionSaves).toHaveLength(1);
    await manager.onApplicationShutdown();
    source.destroy();
    vi.useRealTimers();
  });
});
