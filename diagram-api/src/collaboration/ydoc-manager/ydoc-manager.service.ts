import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import type { RawData, WebSocket } from 'ws';
import * as Y from 'yjs';
import { DataSource, Repository } from 'typeorm';
import { Diagram } from '../../diagrams/entities/diagram.entity.js';
import { ResourceRole } from '../../permissions/permission.types.js';
import {
  DiagramDocumentState,
  VersionStateProvider,
  type DiagramVisualLayout,
} from '../../versions/version-state.provider.js';
import { VersionType } from '../../versions/entities/version.entity.js';
import {
  insertDiagramVersion,
  lockDiagramForVersion,
} from '../../versions/version-persistence.js';
import { CollaborationActor } from '../collaboration-actor.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const SERVER_ORIGIN = Symbol('server-restore');

interface ClientContext {
  actor: CollaborationActor;
  role: ResourceRole;
  awarenessClientIds: Set<number>;
}

interface Room {
  diagramId: string;
  doc: Y.Doc;
  awareness: Awareness;
  clients: Map<WebSocket, ClientContext>;
  saveTimer?: NodeJS.Timeout;
  checkpointTimer?: NodeJS.Timeout;
  evictionTimer?: NodeJS.Timeout;
  checkpointDirty: boolean;
  checkpointActor: CollaborationActor;
}

export function createDocumentFromDiagram(
  diagram: Pick<
    Diagram,
    'currentContent' | 'currentConfig' | 'visualLayout' | 'yjsState'
  >,
): Y.Doc {
  const doc = new Y.Doc();
  if (diagram.yjsState?.length) {
    Y.applyUpdate(doc, diagram.yjsState);
  } else {
    doc.getText('code').insert(0, diagram.currentContent);
    doc.getText('config').insert(0, diagram.currentConfig);
  }
  if (diagram.visualLayout && doc.getMap('visualLayout').size === 0) {
    for (const [key, value] of Object.entries(diagram.visualLayout)) {
      doc.getMap('visualLayout').set(key, value);
    }
  }
  return doc;
}

export function readDocumentState(doc: Y.Doc): DiagramDocumentState {
  return {
    content: doc.getText('code').toString(),
    config: doc.getText('config').toString(),
    visualLayout:
      doc.getMap('visualLayout').size > 0
        ? (doc.getMap('visualLayout').toJSON() as DiagramVisualLayout)
        : null,
  };
}

export function replaceDocumentState(
  doc: Y.Doc,
  state: DiagramDocumentState,
  origin: unknown = SERVER_ORIGIN,
): void {
  doc.transact(() => {
    const code = doc.getText('code');
    const config = doc.getText('config');
    code.delete(0, code.length);
    code.insert(0, state.content);
    config.delete(0, config.length);
    config.insert(0, state.config);
    const layout = doc.getMap('visualLayout');
    layout.clear();
    if (state.visualLayout) {
      for (const [key, value] of Object.entries(state.visualLayout)) {
        layout.set(key, value);
      }
    }
  }, origin);
}

export function canApplySyncMessage(
  role: ResourceRole,
  syncMessageType: number,
): boolean {
  return (
    role !== ResourceRole.Viewer ||
    syncMessageType === syncProtocol.messageYjsSyncStep1
  );
}

@Injectable()
export class YdocManagerService
  extends VersionStateProvider
  implements OnApplicationShutdown
{
  private readonly logger = new Logger(YdocManagerService.name);
  private readonly rooms = new Map<string, Room>();
  private readonly loading = new Map<string, Promise<Room>>();
  private readonly locks = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(
    @InjectRepository(Diagram)
    private readonly diagrams: Repository<Diagram>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async connect(
    diagramId: string,
    client: WebSocket,
    actorOrUserId: CollaborationActor | string,
    role: ResourceRole,
  ): Promise<void> {
    if (this.shuttingDown) throw new Error('Server is shutting down');
    const room = await this.getOrLoadRoom(diagramId);
    if (room.evictionTimer) clearTimeout(room.evictionTimer);
    room.evictionTimer = undefined;
    const actor: CollaborationActor =
      typeof actorOrUserId === 'string'
        ? { type: 'registered', userId: actorOrUserId }
        : actorOrUserId;
    room.clients.set(client, { actor, role, awarenessClientIds: new Set() });

    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, room.doc);
    this.send(client, encoding.toUint8Array(syncEncoder));

    const awarenessIds = [...room.awareness.getStates().keys()];
    if (awarenessIds.length > 0) {
      this.sendAwareness(client, room.awareness, awarenessIds);
    }
  }

  async handleMessage(
    diagramId: string,
    client: WebSocket,
    data: RawData,
  ): Promise<void> {
    const bytes = toUint8Array(data);
    const maxBytes = this.config.get<number>(
      'COLLABORATION_MAX_MESSAGE_BYTES',
      1048576,
    );
    if (bytes.byteLength > maxBytes) {
      client.close(1009, 'Message too large');
      return;
    }

    const room = this.rooms.get(diagramId);
    const context = room?.clients.get(client);
    if (!room || !context) return;

    try {
      const decoder = decoding.createDecoder(bytes);
      const messageType = decoding.readVarUint(decoder);
      if (messageType === MESSAGE_SYNC) {
        const syncMessageType = decoding.peekVarUint(decoder);
        if (
          context.role === ResourceRole.Viewer &&
          syncMessageType === syncProtocol.messageYjsSyncStep2
        ) {
          // A normal y-websocket handshake responds to the server's step 1 with
          // step 2. Ignore it so a viewer's document can never mutate the room.
          return;
        }
        if (!canApplySyncMessage(context.role, syncMessageType)) {
          client.close(4403, 'Viewer cannot update document');
          return;
        }
        await this.runExclusive(diagramId, async () => {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);
          if (encoding.length(encoder) > 1) {
            this.send(client, encoding.toUint8Array(encoder));
          }
        });
      } else if (messageType === MESSAGE_AWARENESS) {
        applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          client,
        );
      }
    } catch {
      this.logger.warn(`Invalid collaboration message for ${diagramId}`);
      client.close(1003, 'Invalid collaboration message');
    }
  }

  async disconnect(diagramId: string, client: WebSocket): Promise<void> {
    const room = this.rooms.get(diagramId);
    const context = room?.clients.get(client);
    if (!room || !context) return;
    room.clients.delete(client);
    removeAwarenessStates(
      room.awareness,
      [...context.awarenessClientIds],
      client,
    );
    if (room.clients.size === 0) {
      await this.runExclusive(diagramId, () => this.flush(room));
      this.scheduleEviction(room);
    }
  }

  disconnectUser(diagramId: string, userId: string): void {
    const room = this.rooms.get(diagramId);
    if (!room) return;
    for (const [client, context] of room.clients) {
      if (
        context.actor.type === 'registered' &&
        context.actor.userId === userId
      ) {
        client.close(4403, 'Diagram permission changed');
      }
    }
  }

  disconnectUserFromDiagrams(
    diagramIds: Iterable<string>,
    userId: string,
  ): void {
    for (const diagramId of diagramIds) this.disconnectUser(diagramId, userId);
  }

  disconnectPublicLink(publicLinkId: string): void {
    for (const room of this.rooms.values()) {
      for (const [client, context] of room.clients) {
        if (
          context.actor.type === 'public' &&
          context.actor.publicLinkId === publicLinkId
        ) {
          client.close(4403, 'Public link changed');
        }
      }
    }
  }

  override isRoomActive(diagramId: string): boolean {
    return (this.rooms.get(diagramId)?.clients.size ?? 0) > 0;
  }

  override async getAuthoritativeState(
    diagram: Diagram,
  ): Promise<DiagramDocumentState> {
    const room = this.rooms.get(diagram.id);
    return room
      ? readDocumentState(room.doc)
      : super.getAuthoritativeState(diagram);
  }

  override async replaceActiveState(
    diagramId: string,
    state: DiagramDocumentState,
  ): Promise<void> {
    const room = this.rooms.get(diagramId);
    if (!room) return;
    replaceDocumentState(room.doc, state);
    await this.flush(room);
  }

  override resetCheckpointState(diagramId: string): void {
    const room = this.rooms.get(diagramId);
    if (!room) return;
    if (room.checkpointTimer) clearTimeout(room.checkpointTimer);
    room.checkpointTimer = undefined;
    room.checkpointDirty = false;
  }

  override async runExclusive<T>(
    diagramId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(diagramId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    this.locks.set(diagramId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(diagramId) === current) this.locks.delete(diagramId);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all([...this.rooms.values()].map((room) => this.flush(room)));
    for (const room of this.rooms.values()) this.destroyRoom(room);
    this.rooms.clear();
  }

  private async getOrLoadRoom(diagramId: string): Promise<Room> {
    const existing = this.rooms.get(diagramId);
    if (existing) return existing;
    const inFlight = this.loading.get(diagramId);
    if (inFlight) return inFlight;

    const loading = this.loadRoom(diagramId).finally(() => {
      this.loading.delete(diagramId);
    });
    this.loading.set(diagramId, loading);
    return loading;
  }

  private async loadRoom(diagramId: string): Promise<Room> {
    const diagram = await this.diagrams.findOneBy({ id: diagramId });
    if (!diagram) throw new NotFoundException('Diagram not found');
    const doc = createDocumentFromDiagram(diagram);
    const room: Room = {
      diagramId,
      doc,
      awareness: new Awareness(doc),
      clients: new Map(),
      checkpointDirty: false,
      checkpointActor: { type: 'registered', userId: diagram.ownerId },
    };

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(room, encoding.toUint8Array(encoder));
      this.scheduleSave(room);
      if (origin !== SERVER_ORIGIN && room.clients.size > 0) {
        room.checkpointDirty = true;
        const client = room.clients.get(origin as WebSocket);
        if (client) room.checkpointActor = client.actor;
        this.scheduleCheckpoint(room);
      }
    });
    room.awareness.on(
      'update',
      (
        changes: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changed = [
          ...changes.added,
          ...changes.updated,
          ...changes.removed,
        ];
        if (origin && room.clients.has(origin as WebSocket)) {
          const ids = room.clients.get(origin as WebSocket)!.awarenessClientIds;
          for (const id of [...changes.added, ...changes.updated]) ids.add(id);
          for (const id of changes.removed) ids.delete(id);
        }
        if (changed.length > 0) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(
            encoder,
            encodeAwarenessUpdate(room.awareness, changed),
          );
          this.broadcast(room, encoding.toUint8Array(encoder));
        }
      },
    );
    this.rooms.set(diagramId, room);
    return room;
  }

  private scheduleSave(room: Room): void {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(
      () => {
        void this.runExclusive(room.diagramId, () => this.flush(room)).catch(
          (error: unknown) =>
            this.logger.error(
              `Failed to persist collaboration room ${room.diagramId}`,
              error instanceof Error ? error.stack : undefined,
            ),
        );
      },
      this.config.get<number>('COLLABORATION_SAVE_DEBOUNCE_MS', 3000),
    );
  }

  private async flush(room: Room): Promise<void> {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = undefined;
    const state = readDocumentState(room.doc);
    await this.diagrams.update(room.diagramId, {
      currentContent: state.content,
      currentConfig: state.config,
      visualLayout: state.visualLayout,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(room.doc)),
    });
  }

  private scheduleCheckpoint(room: Room): void {
    if (room.checkpointTimer) return;
    room.checkpointTimer = setTimeout(
      () => {
        room.checkpointTimer = undefined;
        void this.runExclusive(room.diagramId, () =>
          this.createCheckpoint(room),
        ).catch((error: unknown) => {
          this.logger.error(
            `Failed to checkpoint collaboration room ${room.diagramId}`,
            error instanceof Error ? error.stack : undefined,
          );
          if (room.checkpointDirty && this.rooms.get(room.diagramId) === room) {
            this.scheduleCheckpoint(room);
          }
        });
      },
      this.config.get<number>(
        'COLLABORATION_CHECKPOINT_INTERVAL_MS',
        20 * 60 * 1000,
      ),
    );
  }

  private async createCheckpoint(room: Room): Promise<void> {
    if (!room.checkpointDirty || this.rooms.get(room.diagramId) !== room)
      return;
    const state = readDocumentState(room.doc);
    await this.dataSource.transaction(async (manager) => {
      const diagram = await lockDiagramForVersion(manager, room.diagramId);
      const version = await insertDiagramVersion(
        manager,
        diagram,
        state,
        VersionType.Checkpoint,
        'Automatic collaboration checkpoint',
        room.checkpointActor,
      );
      diagram.currentVersionId = version.id;
      await manager.save(Diagram, diagram);
    });
    room.checkpointDirty = false;
  }

  private scheduleEviction(room: Room): void {
    room.evictionTimer = setTimeout(
      () => {
        if (room.clients.size > 0 || this.rooms.get(room.diagramId) !== room)
          return;
        this.destroyRoom(room);
        this.rooms.delete(room.diagramId);
      },
      this.config.get<number>('COLLABORATION_IDLE_TIMEOUT_MS', 60000),
    );
  }

  private destroyRoom(room: Room): void {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    if (room.checkpointTimer) clearTimeout(room.checkpointTimer);
    if (room.evictionTimer) clearTimeout(room.evictionTimer);
    room.awareness.destroy();
    room.doc.destroy();
  }

  private broadcast(room: Room, message: Uint8Array): void {
    for (const client of room.clients.keys()) this.send(client, message);
  }

  private sendAwareness(
    client: WebSocket,
    awareness: Awareness,
    ids: number[],
  ): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, ids));
    this.send(client, encoding.toUint8Array(encoder));
  }

  private send(client: WebSocket, message: Uint8Array): void {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

function toUint8Array(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
