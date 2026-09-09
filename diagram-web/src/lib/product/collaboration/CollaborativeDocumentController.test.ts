import { describe, expect, it, vi } from 'vitest';
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CollaborativeDocumentController } from './CollaborativeDocumentController';

class FakeAwareness {
  private state: Record<string, unknown> = {};
  getStates() {
    return new Map([[1, this.state]]);
  }
  setLocalState(value: Record<string, unknown> | null) {
    this.state = value ?? {};
  }
  setLocalStateField(key: string, value: unknown) {
    this.state[key] = value;
  }
  on() {
    return undefined;
  }
  off() {
    return undefined;
  }
}

class FakeProvider {
  awareness = new FakeAwareness();
  private handlers = new Map<string, Set<(...arguments_: never[]) => void>>();
  connect = vi.fn();
  destroy = vi.fn();
  on(name: string, handler: (...arguments_: never[]) => void) {
    const handlers = this.handlers.get(name) ?? new Set();
    handlers.add(handler);
    this.handlers.set(name, handlers);
  }
  off(name: string, handler: (...arguments_: never[]) => void) {
    this.handlers.get(name)?.delete(handler);
  }
  emit(name: string) {
    for (const handler of this.handlers.get(name) ?? []) handler();
  }
}

describe('CollaborativeDocumentController', () => {
  it('gets a fresh single-use ticket before recreating a provider', async () => {
    const providers: FakeProvider[] = [];
    const tickets = ['ticket-1', 'ticket-2'];
    const params: Record<string, string>[] = [];
    let reconnect: (() => void) | undefined;
    const controller = new CollaborativeDocumentController({
      apiBaseUrl: 'https://api.example.test',
      browserOrigin: 'https://app.example.test',
      diagramId: 'diagram-1',
      getTicket: vi.fn(async () => ({
        expiresAt: '2026-09-08T00:00:00Z',
        role: 'editor' as const,
        ticket: tickets.shift() ?? 'unexpected-ticket',
        websocketPath: '/ws/collaboration'
      })),
      providerFactory: ((
        _serverUrl: string,
        _room: string,
        _doc: Y.Doc,
        options: ConstructorParameters<typeof WebsocketProvider>[3]
      ) => {
        params.push(options?.params ?? {});
        const provider = new FakeProvider();
        providers.push(provider);
        return provider as unknown as WebsocketProvider;
      }) as never,
      schedule: ((callback: () => void) => {
        reconnect = callback;
        return 1;
      }) as never,
      user: { displayName: 'Ada Lovelace', email: 'ada@example.com', id: 'user-1' }
    });

    await controller.start();
    providers[0].emit('connection-close');
    reconnect?.();
    await vi.waitFor(() => expect(providers).toHaveLength(2));

    expect(params).toEqual([
      { diagramId: 'diagram-1', ticket: 'ticket-1' },
      { diagramId: 'diagram-1', ticket: 'ticket-2' }
    ]);
    expect(providers[0].destroy).toHaveBeenCalledOnce();
    controller.destroy();
  });
});
