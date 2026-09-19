import { describe, expect, it } from 'vitest';
import { buildSourceNavigationIndex, sourceLines } from './sourceNavigationIndex';

describe('source navigation index', () => {
  it('does not count relationship-like text in attribute comments as edges', () => {
    const code =
      'erDiagram\nPRODUCT {\n string note "old -- new"\n}\nPRODUCT ||--o{ IMAGE : contains';
    const index = buildSourceNavigationIndex(code, 'er');
    expect(index.edges.map((range) => code.slice(range.start, range.end))).toEqual([
      'PRODUCT ||--o{ IMAGE : contains'
    ]);
  });
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

  it('indexes fields under quoted dotted ER entity names', () => {
    const index = buildSourceNavigationIndex(
      [
        'erDiagram',
        '  "catalog.PRODUCTS" {',
        '    UUID id PK',
        '    VARCHAR(255) product_name',
        '  }'
      ].join('\n'),
      'er'
    );

    expect(index.declarations.has('catalog.PRODUCTS')).toBe(true);
    expect(index.children.get('catalog.PRODUCTS')).toHaveLength(2);
  });
});
