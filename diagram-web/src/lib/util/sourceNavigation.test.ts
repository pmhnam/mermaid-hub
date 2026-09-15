import { describe, expect, it } from 'vitest';
import { annotateSvgSourceNavigation, sourceRangeForSvgTarget } from './sourceNavigation';

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

  it('maps ER fields and relationships to their own source lines', () => {
    const code = [
      'erDiagram',
      '  CUSTOMER {',
      '    UUID id PK',
      '    TEXT status',
      '  }',
      '  ORDER {',
      '    UUID id PK',
      '  }',
      '  CUSTOMER ||--o{ ORDER : places'
    ].join('\n');
    const field = targetFrom(
      '<svg><g id="graph-entity-CUSTOMER-0"><rect class="row-rect-even" /><g class="attribute-name"><text>id</text></g><g class="attribute-name"><text>status</text></g></g></svg>',
      '.attribute-name:nth-of-type(2)'
    );
    const row = targetFrom(
      '<svg><g id="graph-entity-CUSTOMER-0"><rect class="row-rect-even" /><rect class="row-rect-odd" /></g></svg>',
      '.row-rect-odd'
    );
    const edge = targetFrom(
      '<svg><path class="relationshipLine" data-et="edge" data-id="id_entity-CUSTOMER-0_entity-ORDER-1_0" /></svg>',
      'path'
    );

    annotateSvgSourceNavigation(code, 'er', field.closest('svg') as SVGSVGElement);
    annotateSvgSourceNavigation(code, 'er', row.closest('svg') as SVGSVGElement);
    annotateSvgSourceNavigation(code, 'er', edge.closest('svg') as SVGSVGElement);

    expect(selectedText(code, field, 'er')).toBe('TEXT status');
    expect(selectedText(code, row, 'er')).toBe('TEXT status');
    expect(selectedText(code, edge, 'er')).toBe('CUSTOMER ||--o{ ORDER : places');
  });

  it('keeps ER fields specific when only the table has source metadata', () => {
    const code = ['erDiagram', '  CUSTOMER {', '    UUID id PK', '    TEXT status', '  }'].join(
      '\n'
    );
    const field = targetFrom(
      '<svg><g id="graph-entity-CUSTOMER-0" data-source-start="11" data-source-end="21"><g class="attribute-name"><text>id</text></g><g class="attribute-name" data-field="status"><text>status</text></g></g></svg>',
      '[data-field="status"] text'
    );

    expect(selectedText(code, field, 'er')).toBe('TEXT status');
  });

  it('maps nested class members and sequence messages', () => {
    const classCode = 'classDiagram\n  class Animal {\n    +name: string\n    +move()\n  }';
    const member = targetFrom(
      '<svg><g id="graph-classId-Animal-0"><g class="members-group"><g class="label"><text>name</text></g><g class="label"><text>move</text></g></g></g></svg>',
      '.label:nth-of-type(2)'
    );
    annotateSvgSourceNavigation(classCode, 'class', member.closest('svg') as SVGSVGElement);
    expect(selectedText(classCode, member, 'class')).toBe('+move()');

    const sequenceCode = 'sequenceDiagram\n  Alice->>Bob: First\n  Bob-->>Alice: Second';
    const message = targetFrom(
      '<svg><g data-et="message" data-id="i0"><text class="messageText">First</text></g><g data-et="message" data-id="i1"><text class="messageText">Second</text></g></svg>',
      'g[data-id="i1"] .messageText'
    );
    annotateSvgSourceNavigation(sequenceCode, 'sequence', message.closest('svg') as SVGSVGElement);
    expect(selectedText(sequenceCode, message, 'sequence')).toBe('Bob-->>Alice: Second');
  });

  it('maps Gantt tasks and sections by source order', () => {
    const code =
      'gantt\n  title Plan\n  section Build\n  API :done, api, 2025-01-01, 2d\n  UI :active, ui, after api, 2d';
    const task = targetFrom(
      '<svg><rect class="task" id="graph-task-api" /><rect class="task" id="graph-task-ui" /></svg>',
      '#graph-task-ui'
    );
    const section = targetFrom(
      '<svg><text class="sectionTitle">Build</text></svg>',
      '.sectionTitle'
    );
    annotateSvgSourceNavigation(code, 'gantt', task.closest('svg') as SVGSVGElement);
    annotateSvgSourceNavigation(code, 'gantt', section.closest('svg') as SVGSVGElement);
    expect(selectedText(code, task, 'gantt')).toBe('UI :active, ui, after api, 2d');
    expect(selectedText(code, section, 'gantt')).toBe('section Build');
  });
});
