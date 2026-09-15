import type { SourceRange } from '$lib/types';

export interface SourceLine {
  end: number;
  start: number;
  text: string;
}

export interface SourceNavigationIndex {
  children: Map<string, SourceRange[]>;
  declarations: Map<string, SourceRange>;
  edges: SourceRange[];
  messages: SourceRange[];
  sections: SourceRange[];
  tasks: SourceRange[];
}

export const sourceLines = (code: string): SourceLine[] => {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const rawLine of code.split('\n')) {
    const text = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    lines.push({ end: start + text.length, start, text });
    start += rawLine.length + 1;
  }
  return lines;
};

export const selectableRange = ({ end, start, text }: SourceLine): SourceRange => {
  const leading = text.length - text.trimStart().length;
  return { end, start: start + leading };
};

const isSourceStatement = (line: SourceLine): boolean => {
  const text = line.text.trim();
  return Boolean(text && !text.startsWith('%%') && !text.startsWith('---'));
};

const normalizeIdentifier = (value: string): string => value.trim().replace(/^['"`]|['"`]$/g, '');

const addDeclaration = (
  declarations: Map<string, SourceRange>,
  identifier: string | undefined,
  range: SourceRange
): void => {
  const normalized = identifier ? normalizeIdentifier(identifier) : '';
  if (normalized && !declarations.has(normalized)) declarations.set(normalized, range);
};

const addChildren = (
  children: Map<string, SourceRange[]>,
  parent: string,
  range: SourceRange
): void => {
  const values = children.get(parent) ?? [];
  values.push(range);
  children.set(parent, values);
};

const isRelationshipLine = (text: string, diagramType: string): boolean => {
  if (diagramType.startsWith('sequence') || diagramType.startsWith('gantt')) return false;
  if (diagramType.startsWith('requirement')) {
    return /(?:- satisfies| verifies| traces| contains| refines| derives)/i.test(text);
  }
  return /--|==|\.\.|\|[|o{}]|[<>][-.]|[-.][<>]/.test(text);
};

const isSequenceMessage = (text: string): boolean =>
  /^\s*[^:]+?\s*(?:-+>>?|=+>>?|--?x|--?\)|--?\))/i.test(text);

const scanEntityBlocks = (
  lines: SourceLine[],
  declarations: Map<string, SourceRange>,
  children: Map<string, SourceRange[]>
): void => {
  lines.forEach((line, index) => {
    const opening = line.text.match(/^\s*((?:"[^"]+"|'[^']+'|`[^`]+`|[\w.-]+))\s*\{/);
    if (!opening?.[1]) return;
    const entity = normalizeIdentifier(opening[1]);
    addDeclaration(declarations, entity, selectableRange(line));
    for (const child of lines.slice(index + 1)) {
      if (child.text.trim() === '}') break;
      if (isSourceStatement(child)) {
        addChildren(children, entity, selectableRange(child));
      }
    }
  });
};

const scanBracedDeclarations = (
  lines: SourceLine[],
  pattern: RegExp,
  declarations: Map<string, SourceRange>,
  children: Map<string, SourceRange[]>,
  childPredicate: (text: string) => boolean
): void => {
  lines.forEach((line, index) => {
    const match = line.text.match(pattern);
    if (!match?.[1]) return;
    const parent = normalizeIdentifier(match[1]);
    addDeclaration(declarations, parent, selectableRange(line));
    for (const child of lines.slice(index + 1)) {
      if (child.text.trim() === '}') break;
      if (isSourceStatement(child) && childPredicate(child.text)) {
        addChildren(children, parent, selectableRange(child));
      }
    }
  });
};

const scanGantt = (lines: SourceLine[], tasks: SourceRange[], sections: SourceRange[]): void => {
  for (const line of lines) {
    const text = line.text.trim();
    if (/^section\s+/i.test(text)) {
      sections.push(selectableRange(line));
    } else if (
      isSourceStatement(line) &&
      !/^(?:gantt|dateFormat|axisFormat|todayMarker|title|excludes|includes|section)\b/i.test(
        text
      ) &&
      /^.+:\s*[^:]+,/.test(text)
    ) {
      tasks.push(selectableRange(line));
    }
  }
};

export const identifierFromSemanticValue = (value: string): string | null => {
  const nodeMatch = value.match(
    /(?:^|[-])(?:flowchart|classId|state|entity|requirement|element|service|group)-(.+?)-\d+$/
  );
  if (nodeMatch?.[1]) return normalizeIdentifier(nodeMatch[1]);
  const taskMatch = value.match(/-task-(.+?)(?:-text)?$/);
  return taskMatch?.[1] ? normalizeIdentifier(taskMatch[1]) : null;
};

export const buildSourceNavigationIndex = (
  code: string,
  diagramType: string
): SourceNavigationIndex => {
  const lines = sourceLines(code);
  const family = diagramType.toLowerCase();
  const index: SourceNavigationIndex = {
    children: new Map(),
    declarations: new Map(),
    edges: [],
    messages: [],
    sections: [],
    tasks: []
  };

  if (family.startsWith('er')) scanEntityBlocks(lines, index.declarations, index.children);
  if (family.startsWith('class')) {
    scanBracedDeclarations(
      lines,
      /^\s*(?:class\s+)?([\w-]+)(?:\s+extends\b[^{]+)?\s*\{/i,
      index.declarations,
      index.children,
      (text) => !/^\s*(?:class|%%|})\b/i.test(text)
    );
  }
  if (family.startsWith('requirement')) {
    scanBracedDeclarations(
      lines,
      /^\s*(?:requirement|element)\s+([\w-]+)\s*\{/i,
      index.declarations,
      index.children,
      (text) => /^\s*(?:id|text|risk|verif|type|docref)\s*:/i.test(text)
    );
  }

  for (const line of lines) {
    if (!isSourceStatement(line)) continue;
    const range = selectableRange(line);

    const classDeclaration = line.text.match(/^\s*class\s+([\w-]+)/i);
    const stateDeclaration = line.text.match(/^\s*state\s+([\w-]+)(?:\s+as\b|\s*\{|\s*$)/i);
    const requirementDeclaration = line.text.match(/^\s*(?:requirement|element)\s+([\w-]+)/i);
    const blockDeclaration = line.text.match(/^\s*block:\s*([\w-]+)/i);
    const simpleNode = line.text.match(/^\s*([\w-]+)\s*(?:\[|\(|\{|\]|$)/);
    addDeclaration(index.declarations, classDeclaration?.[1], range);
    addDeclaration(index.declarations, stateDeclaration?.[1], range);
    addDeclaration(index.declarations, requirementDeclaration?.[1], range);
    addDeclaration(index.declarations, blockDeclaration?.[1], range);
    if (!isRelationshipLine(line.text, family))
      addDeclaration(index.declarations, simpleNode?.[1], range);
    if (family.startsWith('class')) {
      const inlineMember = line.text.match(/^\s*([\w-]+)\s*:\s*(\S.*)$/);
      if (inlineMember?.[1] && inlineMember[2]) {
        addChildren(index.children, inlineMember[1], range);
      }
    }

    if (family.startsWith('sequence') && isSequenceMessage(line.text)) {
      index.messages.push(range);
    } else if (family.startsWith('gantt')) {
      // Gantt task and section records are collected in one pass below.
    } else if (isRelationshipLine(line.text, family)) {
      index.edges.push(range);
    }
  }

  if (family.startsWith('gantt')) scanGantt(lines, index.tasks, index.sections);
  return index;
};
