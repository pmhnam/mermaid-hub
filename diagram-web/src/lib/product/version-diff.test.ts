import { describe, expect, it } from 'vitest';
import { createVersionDiff } from './version-diff';

describe('version diff', () => {
  it('diffs content and config by line from the live document to the version', () => {
    const result = createVersionDiff(
      { config: '{\n  "theme": "dark"\n}', content: 'flowchart LR\nA --> B' },
      { config: '{\n  "theme": "forest"\n}', content: 'flowchart TD\nA --> C' }
    );

    expect(result.content.some((part) => part.removed && part.value.includes('flowchart LR'))).toBe(
      true
    );
    expect(result.content.some((part) => part.added && part.value.includes('flowchart TD'))).toBe(
      true
    );
    expect(result.config.some((part) => part.added && part.value.includes('forest'))).toBe(true);
  });
});
