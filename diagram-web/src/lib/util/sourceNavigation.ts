import type { SourceRange } from '$lib/types';

interface SourceLine {
  end: number;
  start: number;
  text: string;
}

const sourceLines = (code: string): SourceLine[] => {
  let offset = 0;
  return code.split('\n').map((text) => {
    const start = offset;
    offset += text.length + 1;
    return { end: start + text.length, start, text };
  });
};

const selectableRange = ({ end, start, text }: SourceLine): SourceRange => {
  const leading = text.length - text.trimStart().length;
  return { end, start: start + leading };
};

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

const identifierFromValue = (value: string): string | null => {
  const nodeMatch = value.match(
    /(?:^|-)(?:flowchart|classId|state|entity|requirement|element|service|group)-(.+?)-\d+$/
  );
  if (nodeMatch?.[1]) return nodeMatch[1];
  const taskMatch = value.match(/-task-(.+?)(?:-text)?$/);
  return taskMatch?.[1] ?? null;
};

const rangeFromSemanticValue = (
  lines: SourceLine[],
  diagramType: string,
  value: string
): SourceRange | null => {
  const identifier = identifierFromValue(value);
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
  const lines = sourceLines(code);
  for (const value of semanticValues(target, svg)) {
    const range = rangeFromSemanticValue(lines, diagramType, value);
    if (range) return range;
  }
  return rangeFromUniqueText(lines, target);
};
