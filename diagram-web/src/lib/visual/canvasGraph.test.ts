import { describe, expect, it } from 'vitest';
import { relatedNodes, unionBounds } from './canvasGraph';
import { LayoutHistory } from './layoutHistory';
import { emptyVisualLayout } from './layout';
import { renameErEntity, themeDocument } from './documentEdits';

describe('canvas operations', () => {
  it('focuses only the requested relationship depth, handling cycles', () => {
    const edges = [
      { nodeIds: ['A', 'B'] },
      { nodeIds: ['B', 'C'] },
      { nodeIds: ['C', 'A'] },
      { nodeIds: ['C', 'D'] }
    ];
    expect([...relatedNodes(['A'], edges, 1)].sort()).toEqual(['A', 'B', 'C']);
    expect([...relatedNodes(['A'], edges, 2)].sort()).toEqual(['A', 'B', 'C', 'D']);
  });
  it('includes negative coordinates when fitting manual positions', () => {
    expect(
      unionBounds([
        { height: 10, width: 10, x: -20, y: -30 },
        { height: 10, width: 40, x: 50, y: 30 }
      ])
    ).toEqual({ height: 70, width: 110, x: -20, y: -30 });
  });
  it('undoes local offsets without overwriting newer remote edits', () => {
    const history = new LayoutHistory();
    const before = emptyVisualLayout('elk');
    const after = { ...before, offsets: { A: { x: 20, y: 30 }, B: { x: 10, y: 10 } } };
    history.record(before, after);
    const current = {
      ...after,
      offsets: { ...after.offsets, B: { x: 90, y: 90 }, C: { x: -10, y: 0 } }
    };
    const undone = history.step(current);
    expect(undone?.offsets).toEqual({ B: { x: 90, y: 90 }, C: { x: -10, y: 0 } });
    expect(undone && history.step(undone, true)?.offsets).toEqual({ ...current.offsets });
  });
  it('renames quoted ER identifiers without changing field comments or labels', () => {
    const code =
      'erDiagram\n"catalog.A" {\n text id "catalog.A"\n}\n"catalog.A" ||--o{ B : catalog.A';
    expect(renameErEntity(code, 'catalog.A', 'catalog.NEW')).toBe(
      'erDiagram\n"catalog.NEW" {\n text id "catalog.A"\n}\n"catalog.NEW" ||--o{ B : catalog.A'
    );
  });
  it('sets effective theme without losing frontmatter layout or comments', () => {
    const result = themeDocument(
      {
        code: '---\nconfig:\n  layout: elk # keep\n  theme: dark\n---\nerDiagram\nA ||--o{ B : has',
        config: '{}'
      },
      'forest'
    );
    expect(result.code).toContain('layout: elk # keep');
    expect(result.code).toContain('theme: forest');
    expect(JSON.parse(result.config).theme).toBe('forest');
  });
  it('preserves colon-containing labels, updates styles and rejects implicit-name collisions', () => {
    const code = 'erDiagram\nA ||--o{ B : "A: owns B"\nstyle A fill:red';
    expect(renameErEntity(code, 'A', 'NEW')).toBe(
      'erDiagram\n"NEW" ||--o{ B : "A: owns B"\nstyle NEW fill:red'
    );
    expect(() => renameErEntity(code, 'A', 'B')).toThrow('already exists');
  });
});
