import { describe, expect, it, vi } from 'vitest';
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { CollaborativeDocumentController } from './CollaborativeDocumentController';

class FakeAwareness {
  private state: Record<string, unknown> = {};
  getStates() {
    return new Map([[1, this.state]]);
  }
  getLocalState() {
    return this.state;
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
  it('keeps relationship routes through collaboration updates and clears them on auto-layout', () => {
    const controller = new CollaborativeDocumentController({
      apiBaseUrl: '',
      browserOrigin: 'https://app.example.test',
      diagramId: 'diagram-1',
      getTicket: vi.fn(),
      user: { displayName: 'Ada', id: 'user-1' }
    });
    const layout = {
      arrangement: {
        version: 1 as const,
        assignments: [{ tableId: 'A', service: 'Orders', database: 'orders' }]
      },
      edgeRoutes: { '["A","B",0]': [{ x: 120, y: 100 }] },
      engine: 'elk' as const,
      mode: 'manual' as const,
      offsets: {}
    };
    controller.setVisualLayout(layout);
    expect(controller.getVisualLayout()).toEqual(layout);
    controller.setDocumentAndVisualLayout('erDiagram\nA ||--o{ B : has', '{}', layout);
    expect(controller.getVisualLayout()).toEqual(layout);
    controller.setVisualLayout({ engine: 'elk', mode: 'auto', offsets: {} });
    expect(controller.getVisualLayout()?.edgeRoutes).toBeUndefined();
    expect(controller.getVisualLayout()?.arrangement).toBeUndefined();
    controller.destroy();
  });
  it('updates code, config, and visual layout in one transaction', () => {
    const controller = new CollaborativeDocumentController({
      apiBaseUrl: 'https://api.example.test',
      browserOrigin: 'https://app.example.test',
      diagramId: 'diagram-1',
      getTicket: vi.fn(),
      user: { displayName: 'Ada Lovelace', id: 'user-1' }
    });
    const originalCode = '---\nconfig:\n  layout: elk\n---\nflowchart LR';
    controller.code.insert(0, originalCode);
    controller.config.insert(0, '{}');
    controller.setVisualLayout({
      engine: 'elk',
      mode: 'manual',
      offsets: { A: { x: 10, y: 20 } }
    });
    let transactionCount = 0;
    let codeChangeCount = 0;
    controller.doc.on('afterTransaction', () => transactionCount++);
    controller.code.observe(() => codeChangeCount++);

    controller.setDocumentAndVisualLayout(
      '---\nconfig:\n  layout: dagre\n---\nflowchart LR',
      '{"layout":"dagre"}',
      undefined
    );

    expect(transactionCount).toBe(1);
    expect(codeChangeCount).toBe(1);
    expect(controller.code.toString()).toContain('layout: dagre');
    expect(controller.config.toString()).toBe('{"layout":"dagre"}');
    expect(controller.getVisualLayout()).toBeUndefined();

    controller.setDocumentAndVisualLayout(
      controller.code.toString(),
      '{"layout":"elk"}',
      undefined
    );
    expect(codeChangeCount).toBe(1);
  });

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
    controller.setPreviewCursor({ revision: 'revision-1', x: 10, y: 20 });
    expect(providers[0].awareness.getLocalState()).toMatchObject({
      previewCursor: { revision: 'revision-1', x: 10, y: 20 },
      user: { displayName: 'Ada Lovelace', name: 'Ada Lovelace', userId: 'user-1' }
    });
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
