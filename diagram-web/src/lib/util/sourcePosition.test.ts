import { describe, expect, it } from 'vitest';
import { sourcePosition } from './sourcePosition';

describe('source positions across editor line endings', () => {
  it.each(['\n', '\r\n'])('maps fields using %j line endings', (newline) => {
    const code = ['erDiagram', '  PRODUCTS {', '    UUID id PK', '  }'].join(newline);
    expect(sourcePosition(code, code.indexOf('UUID'))).toEqual({ column: 5, lineNumber: 3 });
    expect(sourcePosition(code, code.indexOf(' PK') + 3)).toEqual({ column: 15, lineNumber: 3 });
  });
});
