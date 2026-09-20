import { describe, expect, it } from 'vitest';
import { parseArrangeGraph } from './arrangeGraph';
import mermaid from 'mermaid';

describe('ER graph extraction', () => {
  it('reads aliases, quoted identifiers, implicit endpoints and disconnected tables', async () => {
    mermaid.initialize({ startOnLoad: false });
    const graph = await parseArrangeGraph(
      'erDiagram\n"billing.users" ["Billing users"] {\n UUID id PK\n}\n"billing.users" ||--o{ "identity.users" : references\nAUDIT'
    );
    expect(graph.tables.map((table) => table.id).sort()).toEqual([
      'AUDIT',
      'billing.users',
      'identity.users'
    ]);
    expect(graph.tables.find((table) => table.id === 'billing.users')?.fields).toEqual([
      'id: UUID'
    ]);
    expect(graph.edges).toEqual([{ source: 'billing.users', target: 'identity.users' }]);
  });
});
