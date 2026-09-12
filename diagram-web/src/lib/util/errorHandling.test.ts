import { describe, expect, it } from 'vitest';
import { sourceRangeFromError } from './errorHandling';

describe('sourceRangeFromError', () => {
  it('converts Mermaid locations to absolute offsets', () => {
    const code = 'graph TD\r\n  A -->\r\n  B';
    const error = {
      hash: {
        loc: {
          first_column: 2,
          first_line: 2,
          last_column: 7,
          last_line: 2
        }
      }
    };

    expect(sourceRangeFromError(error, code, 'Parse error')).toEqual({ end: 17, start: 12 });
  });

  it('falls back to the reported line when the parser has no location', () => {
    const code = 'graph TD\nA --> B';

    expect(sourceRangeFromError(new Error('Parse error'), code, 'Parse error')).toEqual({
      end: 8,
      start: 0
    });
  });

  it('uses the matching source line when the parser line is incorrect', () => {
    const code = 'graph TD\nA --> B\nC --> D';
    const error = {
      hash: {
        loc: {
          first_column: 0,
          first_line: 1,
          last_column: 1,
          last_line: 1
        }
      }
    };

    expect(
      sourceRangeFromError(error, code, 'Error: Parse error on line 1:\n   C --> D\n')
    ).toEqual({ end: 24, start: 17 });
  });
});
