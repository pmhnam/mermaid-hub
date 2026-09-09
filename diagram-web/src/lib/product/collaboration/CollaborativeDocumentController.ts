import type { User } from '../types';
import type { TicketLoader } from './lifecycle';
import { presenceColor, readPresence, type PresenceUser } from './presence';
import { reconnectDelay, websocketProviderAddress } from './lifecycle';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

export type CollaborationStatus = 'connecting' | 'disconnected' | 'error' | 'synced';

type Provider = WebsocketProvider;
type ProviderFactory = (
  serverUrl: string,
  room: string,
  doc: Y.Doc,
  options: ConstructorParameters<typeof WebsocketProvider>[3]
) => Provider;

interface ControllerOptions {
  apiBaseUrl: string;
  browserOrigin: string;
  diagramId: string;
  getTicket: TicketLoader;
  providerFactory?: ProviderFactory;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  user: User;
}

export class CollaborativeDocumentController {
  readonly doc = new Y.Doc();
  readonly code = this.doc.getText('code');
  readonly config = this.doc.getText('config');
  error = '';
  presence: PresenceUser[] = [];
  role: 'editor' | 'owner' | 'viewer' = 'viewer';
  status: CollaborationStatus = 'disconnected';
  synced = false;

  private readonly listeners = new Set<() => void>();
  private provider?: Provider;
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private connecting = false;
  private generation = 0;

  constructor(private readonly options: ControllerOptions) {}

  get awareness(): Provider['awareness'] {
    if (!this.provider) throw new Error('Collaboration provider is not initialized');
    return this.provider.awareness;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    await this.connect();
  }

  destroy(): void {
    this.destroyed = true;
    this.generation += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.provider?.awareness.setLocalState(null);
    this.disposeProvider();
    this.doc.destroy();
    this.listeners.clear();
  }

  private async connect(): Promise<void> {
    if (this.destroyed || this.connecting) return;
    this.connecting = true;
    const generation = ++this.generation;
    this.status = 'connecting';
    this.emit();
    try {
      const ticket = await this.options.getTicket();
      if (this.destroyed || generation !== this.generation) return;
      const address = websocketProviderAddress(
        this.options.apiBaseUrl,
        ticket.websocketPath,
        this.options.browserOrigin
      );
      const previousAwareness = this.provider?.awareness;
      this.disposeProvider();
      const factory =
        this.options.providerFactory ??
        ((serverUrl, room, doc, options) => new WebsocketProvider(serverUrl, room, doc, options));
      const provider = factory(address.serverUrl, address.room, this.doc, {
        awareness: previousAwareness,
        connect: false,
        disableBc: true,
        params: { diagramId: this.options.diagramId, ticket: ticket.ticket },
        shouldReconnect: () => false
      });
      this.provider = provider;
      this.role = ticket.role;
      provider.awareness.setLocalStateField('user', {
        color: presenceColor(this.options.user.id),
        displayName: this.options.user.displayName,
        userId: this.options.user.id
      } satisfies PresenceUser);
      provider.awareness.on('change', this.handleAwarenessChange);
      provider.on('status', this.handleStatus);
      provider.on('sync', this.handleSync);
      provider.on('connection-close', this.handleClose);
      provider.on('connection-error', this.handleConnectionError);
      provider.connect();
      this.emit();
    } catch (caught) {
      if (this.destroyed || generation !== this.generation) return;
      this.status = 'error';
      this.error = caught instanceof Error ? caught.message : 'Unable to join collaboration';
      this.emit();
      this.scheduleReconnect();
    } finally {
      if (generation === this.generation) this.connecting = false;
    }
  }

  private readonly handleAwarenessChange = (): void => {
    if (!this.provider) return;
    this.presence = readPresence(this.provider.awareness, this.doc.clientID);
    this.emit();
  };

  private readonly handleStatus = ({ status }: { status: string }): void => {
    if (status !== 'connected') {
      this.status = status === 'connecting' ? 'connecting' : 'disconnected';
      this.emit();
    }
  };

  private readonly handleSync = (synced: boolean): void => {
    this.synced = synced;
    if (synced) {
      this.reconnectAttempt = 0;
      this.error = '';
      this.status = 'synced';
    }
    this.emit();
  };

  private readonly handleClose = (): void => {
    if (this.destroyed) return;
    this.synced = false;
    this.status = 'disconnected';
    this.emit();
    this.scheduleReconnect();
  };

  private readonly handleConnectionError = (): void => {
    this.error = 'Collaboration connection failed';
    this.status = 'error';
    this.emit();
  };

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    const schedule = this.options.schedule ?? setTimeout;
    this.reconnectTimer = schedule(() => {
      this.reconnectTimer = undefined;
      this.connecting = false;
      void this.connect();
    }, reconnectDelay(this.reconnectAttempt++));
  }

  private disposeProvider(): void {
    if (!this.provider) return;
    this.provider.awareness.off('change', this.handleAwarenessChange);
    this.provider.off('status', this.handleStatus);
    this.provider.off('sync', this.handleSync);
    this.provider.off('connection-close', this.handleClose);
    this.provider.off('connection-error', this.handleConnectionError);
    this.provider.destroy();
    this.provider = undefined;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
