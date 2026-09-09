import { describe, expect, it } from 'vitest';
import { sourceRangeForSvgTarget } from './sourceNavigation';

const targetFrom = (markup: string, selector: string): Element => {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = markup;
  const target = wrapper.querySelector(selector);
  if (!target) throw new Error(`Missing test target: ${selector}`);
  return target;
};

const selectedText = (code: string, target: Element, type: string): string | null => {
  const range = sourceRangeForSvgTarget(code, type, target);
  return range ? code.slice(range.start, range.end) : null;
};

describe('preview source navigation', () => {
  it('maps a flowchart node and edge to their source statements', () => {
    const code = 'flowchart LR\n  A[Start]\n  A --> B[Done]';
    const node = targetFrom('<svg><g id="flowchart-A-0"><text>Start</text></g></svg>', 'text');
    const edge = targetFrom('<svg><path data-id="L_A_B_0" /></svg>', 'path');

    expect(selectedText(code, node, 'flowchart-v2')).toBe('A[Start]');
    expect(selectedText(code, edge, 'flowchart-v2')).toBe('A --> B[Done]');
  });

  it('prefers an explicit node declaration over an earlier edge reference', () => {
    const code = 'flowchart LR\n  A --> B\n  B[Detailed label]';
    const node = targetFrom(
      '<svg><g id="graph-flowchart-B-0"><text>Detailed label</text></g></svg>',
      'text'
    );

    expect(selectedText(code, node, 'flowchart-v2')).toBe('B[Detailed label]');
  });

  it('maps flowchart edges whose identifiers contain underscores', () => {
    const code = 'flowchart LR\n  foo_bar --> baz_qux';
    const edge = targetFrom('<svg><path data-id="L_foo_bar_baz_qux_0" /></svg>', 'path');

    expect(selectedText(code, edge, 'flowchart-v2')).toBe('foo_bar --> baz_qux');
  });

  it('maps sequence messages by their rendered ordinal', () => {
    const code = 'sequenceDiagram\nAlice->>Bob: First\nBob-->>Alice: Second';
    const target = targetFrom('<svg><line data-id="i1" /></svg>', 'line');

    expect(selectedText(code, target, 'sequence')).toBe('Bob-->>Alice: Second');
  });

  it('maps zero-based state transition ordinals', () => {
    const code = 'stateDiagram-v2\nStill --> Moving\nMoving --> Still';
    const target = targetFrom('<svg><path data-id="edge1" /></svg>', 'path');

    expect(selectedText(code, target, 'state')).toBe('Moving --> Still');
  });

  it.each([
    [
      'classDiagram\nclass Animal {\n  +name\n}',
      'class',
      'graph-classId-Animal-0',
      'class Animal {'
    ],
    ['stateDiagram-v2\nStill --> Moving', 'state', 'graph-state-Still-1', 'Still --> Moving'],
    [
      'erDiagram\nCUSTOMER ||--o{ ORDER : places',
      'er',
      'graph-entity-CUSTOMER-0',
      'CUSTOMER ||--o{ ORDER : places'
    ],
    [
      'requirementDiagram\nrequirement fast {\n  id: 1\n}',
      'requirement',
      'graph-requirement-fast-0',
      'requirement fast {'
    ]
  ])('maps a %s semantic node', (code, type, id, expected) => {
    const target = targetFrom(`<svg><g id="${id}"><text>Label</text></g></svg>`, 'text');
    expect(selectedText(code, target, type)).toBe(expected);
  });

  it('does not guess for unsupported diagrams or duplicate text', () => {
    const duplicate = targetFrom('<svg><g><text>Same</text></g></svg>', 'text');
    expect(selectedText('pie\n"Same": 1', duplicate, 'pie')).toBeNull();
    expect(selectedText('flowchart LR\nA[Same]\nB[Same]', duplicate, 'flowchart-v2')).toBeNull();
  });
});
