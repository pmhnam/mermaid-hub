import { describe, expect, it } from 'vitest';
import { buildSourceNavigationIndex, sourceLines } from './sourceNavigationIndex';

describe('source navigation index', () => {
  it('preserves offsets for CRLF source', () => {
    const lines = sourceLines('erDiagram\r\n  CUSTOMER {\r\n    UUID id PK\r\n  }');

    expect(lines[1]?.text).toBe('  CUSTOMER {');
    expect(lines[2]?.start).toBe('erDiagram\r\n  CUSTOMER {\r\n'.length);
    expect(lines[2]?.text).toBe('    UUID id PK');
  });

  it('indexes nested ER fields and ordered relationships', () => {
    const index = buildSourceNavigationIndex(
      [
        'erDiagram',
        '  CUSTOMER {',
        '    UUID id PK',
        '  }',
        '  ORDER {',
        '    UUID id PK',
        '  }',
        '  CUSTOMER ||--o{ ORDER : places',
        '  CUSTOMER ||--o{ ORDER : ships'
      ].join('\n'),
      'er'
    );

    expect(index.declarations.has('CUSTOMER')).toBe(true);
    expect(index.children.get('CUSTOMER')).toHaveLength(1);
    expect(index.edges).toHaveLength(2);
  });
});
