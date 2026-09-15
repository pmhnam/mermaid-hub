import type { SourceRange } from '$lib/types';
import {
  buildSourceNavigationIndex,
  identifierFromSemanticValue,
  selectableRange,
  sourceLines,
  type SourceLine
} from './sourceNavigationIndex';

const isSourceStatement = (line: SourceLine): boolean => {
  const text = line.text.trim();
  return Boolean(text && !text.startsWith('%%') && !text.startsWith('---'));
};

const escapeRegex = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const identifierLine = (lines: SourceLine[], identifier: string): SourceLine | undefined => {
  if (!identifier || identifier.length > 128) return undefined;
  const pattern = new RegExp(`(^|[^\\w-])${escapeRegex(identifier)}(?=$|[^\\w-])`);
  const matches = lines.filter((line) => isSourceStatement(line) && pattern.test(line.text));
  const declaration = new RegExp(
    `^\\s*(?:(?:class|state|requirement|element|block|participant|actor|service|group)\\s+)?${escapeRegex(identifier)}(?:\\s+as\\b|\\s*[\\[({>]|\\s*$)`
  );
  return matches.find((line) => declaration.test(line.text)) ?? matches[0];
};

const relationshipLine = (
  lines: SourceLine[],
  left: string,
  right: string
): SourceLine | undefined => {
  const leftPattern = new RegExp(`(^|[^\\w-])${escapeRegex(left)}(?=$|[^\\w-])`);
  const rightPattern = new RegExp(`(^|[^\\w-])${escapeRegex(right)}(?=$|[^\\w-])`);
  return lines.find(
    (line) =>
      isSourceStatement(line) &&
      leftPattern.test(line.text) &&
      rightPattern.test(line.text) &&
      /--|\.\.|==|\|[|o{}]|[<>][-|.]|[-.][<>]/.test(line.text)
  );
};

const indexedLine = (
  lines: SourceLine[],
  index: number,
  predicate: (text: string) => boolean
): SourceLine | undefined =>
  lines.filter((line) => isSourceStatement(line) && predicate(line.text))[index];

const semanticValues = (target: Element, svg: SVGSVGElement): string[] => {
  const values: string[] = [];
  let element: Element | null = target;
  while (element && element !== svg) {
    for (const attribute of ['data-id', 'data-et', 'id']) {
      const value = element.getAttribute(attribute);
      if (value) values.push(value);
    }
    element = element.parentElement;
  }
  return [...new Set(values)];
};

const rangeFromSemanticValue = (
  lines: SourceLine[],
  diagramType: string,
  value: string
): SourceRange | null => {
  const identifier = identifierFromSemanticValue(value);
  if (identifier) {
    const line = identifierLine(lines, identifier);
    if (line) return selectableRange(line);
  }

  if (/^(?:L_|id_)/.test(value)) {
    const relation = lines.find((line) => {
      const match = line.text.match(
        /([A-Za-z_][\w-]*)\s*(?:--+>|--+|\.\.+>|==+>|\|[^\s]+)\s*([A-Za-z_][\w-]*)/
      );
      return Boolean(
        match?.[1] &&
        match[2] &&
        (value.startsWith(`L_${match[1]}_${match[2]}_`) ||
          value.startsWith(`id_${match[1]}_${match[2]}_`))
      );
    });
    if (relation) return selectableRange(relation);
  }

  const edge = value.match(/^(?:L_|id_)(.+?)_(.+?)_\d+$/);
  if (edge?.[1] && edge[2]) {
    const line = relationshipLine(lines, edge[1], edge[2]);
    if (line) return selectableRange(line);
  }

  const sequenceMessage = value.match(/^i(\d+)$/);
  if (sequenceMessage && diagramType.startsWith('sequence')) {
    const line = indexedLine(lines, Number(sequenceMessage[1]), (text) =>
      /(?:--?|==?)[->>x)]/.test(text)
    );
    if (line) return selectableRange(line);
  }

  const orderedEdge = value.match(/^edge(\d+)$/);
  if (orderedEdge && diagramType.startsWith('state')) {
    const line = indexedLine(lines, Number(orderedEdge[1]), (text) => /-->|:/.test(text));
    if (line) return selectableRange(line);
  }

  const direct = identifierLine(lines, value);
  return direct ? selectableRange(direct) : null;
};

const rangeFromUniqueText = (lines: SourceLine[], target: Element): SourceRange | null => {
  const text = (target.closest('g')?.textContent ?? target.textContent ?? '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (text.length < 2 || text.length > 80) return null;
  const matches = lines.filter((line) => isSourceStatement(line) && line.text.includes(text));
  return matches.length === 1 ? selectableRange(matches[0]) : null;
};

const rangeFromErField = (
  code: string,
  target: Element,
  svg: SVGSVGElement
): SourceRange | null => {
  const field = target.closest(
    '.attribute-type, .attribute-name, .attribute-keys, .attribute-comment, .row-rect-even, .row-rect-odd'
  );
  const node = field?.closest('g[id]');
  const identifier = node ? nodeIdentifier(node, svg) : null;
  const fields = identifier
    ? buildSourceNavigationIndex(code, 'er').children.get(identifier)
    : undefined;
  if (!field || !node || !fields?.length) return null;

  const isRow =
    field.classList.contains('row-rect-even') || field.classList.contains('row-rect-odd');
  const className = isRow
    ? '.row-rect-even, .row-rect-odd'
    : [...field.classList]
        .filter((name) => name.startsWith('attribute-'))
        .map((name) => `.${name}`)
        .join(', ');
  if (!className) return null;
  const siblings = [...node.querySelectorAll(className)];
  const fieldIndex = siblings.indexOf(field);
  return fieldIndex >= 0 && fields[fieldIndex] ? fields[fieldIndex] : null;
};

const setSourceRange = (element: Element, range: SourceRange): void => {
  element.setAttribute('data-source-start', String(range.start));
  element.setAttribute('data-source-end', String(range.end));
};

const nodeIdentifier = (element: Element, svg: SVGSVGElement): string | null => {
  let current: Element | null = element;
  while (current && current !== svg) {
    const id = current.getAttribute('id');
    if (id) {
      const identifier = identifierFromSemanticValue(id);
      if (identifier) return identifier;
      const rootId = svg.getAttribute('id');
      if (rootId && id.startsWith(`${rootId}-`)) {
        const rendererIdentifier = id.slice(rootId.length + 1).replace(/-\d+$/, '');
        if (rendererIdentifier) return rendererIdentifier;
      }
    }
    current = current.parentElement;
  }
  return null;
};

const annotateOrdered = (
  elements: Element[],
  ranges: SourceRange[],
  keyFor: (element: Element, index: number) => string
): void => {
  const groups: { elements: Element[]; key: string }[] = [];
  const byKey = new Map<string, { elements: Element[]; key: string }>();
  for (const [elementIndex, element] of elements.entries()) {
    const key = keyFor(element, elementIndex);
    let group = byKey.get(key);
    if (!group) {
      group = { elements: [], key };
      byKey.set(key, group);
      groups.push(group);
    }
    group.elements.push(element);
  }
  groups.forEach((group, index) => {
    const range = ranges[index];
    if (range) group.elements.forEach((element) => setSourceRange(element, range));
  });
};

const semanticKey = (element: Element, fallback: number): string =>
  element.getAttribute('data-id') ?? element.getAttribute('id') ?? `element-${fallback}`;

const annotateNestedRanges = (
  svg: SVGSVGElement,
  diagramType: string,
  index: ReturnType<typeof buildSourceNavigationIndex>
): void => {
  const family = diagramType.toLowerCase();
  const nodeElements = [...svg.querySelectorAll<SVGGElement>('g[id]')];
  for (const element of nodeElements) {
    const identifier = nodeIdentifier(element, svg);
    const range = identifier ? index.declarations.get(identifier) : undefined;
    if (range) setSourceRange(element, range);
  }

  if (family.startsWith('er')) {
    for (const node of nodeElements) {
      const identifier = nodeIdentifier(node, svg);
      const fields = identifier ? index.children.get(identifier) : undefined;
      if (!fields?.length) continue;
      const fieldGroups = [
        ...node.querySelectorAll('.attribute-type'),
        ...node.querySelectorAll('.attribute-name'),
        ...node.querySelectorAll('.attribute-keys'),
        ...node.querySelectorAll('.attribute-comment')
      ];
      for (const fieldGroup of fieldGroups) {
        const className = [...fieldGroup.classList].find((name) => name.startsWith('attribute-'));
        if (!className) continue;
        const siblings = [...node.querySelectorAll(`.${className}`)];
        const fieldIndex = siblings.indexOf(fieldGroup);
        if (fields[fieldIndex]) setSourceRange(fieldGroup, fields[fieldIndex]);
      }
      [...node.querySelectorAll('.row-rect-even, .row-rect-odd')].forEach((row, rowIndex) => {
        if (fields[rowIndex]) setSourceRange(row, fields[rowIndex]);
      });
    }
  }

  if (family.startsWith('class') || family.startsWith('requirement')) {
    for (const node of nodeElements) {
      const identifier = nodeIdentifier(node, svg);
      const children = identifier ? index.children.get(identifier) : undefined;
      if (!children?.length) continue;
      const nested = family.startsWith('class')
        ? [...node.querySelectorAll('.members-group .label, .methods-group .label')]
        : [...node.querySelectorAll('p')];
      nested.forEach((element, childIndex) => {
        if (children[childIndex]) setSourceRange(element, children[childIndex]);
      });
    }
  }

  if (family.startsWith('sequence')) {
    annotateOrdered(
      [...svg.querySelectorAll('[data-et="message"]')],
      index.messages,
      (element, index) => semanticKey(element, index)
    );
    annotateOrdered([...svg.querySelectorAll('.messageText')], index.messages, (element, index) =>
      semanticKey(element, index)
    );
  }

  if (family.startsWith('gantt')) {
    annotateOrdered(
      [...svg.querySelectorAll('rect.task, .task, text[id$="-text"]')],
      index.tasks,
      (element, elementIndex) =>
        element.getAttribute('id')?.replace(/-text$/, '') ?? `task-${elementIndex}`
    );
    annotateOrdered([...svg.querySelectorAll('.sectionTitle')], index.sections, (element, index) =>
      semanticKey(element, index)
    );
  }

  if (!family.startsWith('sequence') && !family.startsWith('gantt')) {
    annotateOrdered(
      [...svg.querySelectorAll('[data-et="edge"], .edgePath, .relationshipLine')],
      index.edges,
      (element, index) => semanticKey(element, index)
    );
  }
};

export const annotateSvgSourceNavigation = (
  code: string,
  diagramType: string,
  svg: SVGSVGElement
): void => {
  annotateNestedRanges(svg, diagramType, buildSourceNavigationIndex(code, diagramType));
};

const rangeFromMetadata = (target: Element, svg: SVGSVGElement): SourceRange | null => {
  let element: Element | null = target;
  while (element && element !== svg) {
    const startValue = element.getAttribute('data-source-start');
    const endValue = element.getAttribute('data-source-end');
    if (startValue !== null && endValue !== null) {
      const start = Number(startValue);
      const end = Number(endValue);
      if (Number.isFinite(start) && Number.isFinite(end)) return { end, start };
    }
    element = element.parentElement;
  }
  return null;
};

export const sourceRangeForSvgTarget = (
  code: string,
  diagramType: string,
  target: Element
): SourceRange | null => {
  const svg = target.closest('svg');
  if (!(svg instanceof SVGSVGElement)) return null;
  const supported = /^(?:flowchart|class|state|er|sequence|requirement|block|gantt)/.test(
    diagramType
  );
  if (!supported) return null;
  if (diagramType.toLowerCase().startsWith('er')) {
    const nestedRange = rangeFromErField(code, target, svg);
    if (nestedRange) return nestedRange;
  }
  const metadataRange = rangeFromMetadata(target, svg);
  if (metadataRange) return metadataRange;
  const lines = sourceLines(code);
  for (const value of semanticValues(target, svg)) {
    const range = rangeFromSemanticValue(lines, diagramType, value);
    if (range) return range;
  }
  return rangeFromUniqueText(lines, target);
};
