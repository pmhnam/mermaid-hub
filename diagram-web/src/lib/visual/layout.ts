import type { MermaidConfig } from 'mermaid';
import { isAlias, isScalar, parseDocument } from 'yaml';

export type LayoutEngine = 'dagre' | 'elk';

export interface VisualLayoutOffset {
  x: number;
  y: number;
}

export interface VisualLayout {
  engine: LayoutEngine;
  mode: 'auto' | 'manual';
  offsets: Record<string, VisualLayoutOffset>;
}

interface FrontmatterLayout {
  end: number;
  engine: LayoutEngine;
  start: number;
}

const supportedDiagramTypes = ['class', 'er', 'flowchart', 'requirement', 'state'];

export const isVisualLayoutSupported = (diagramType: string | undefined): boolean =>
  diagramType !== undefined &&
  supportedDiagramTypes.some((type) => diagramType.toLowerCase().startsWith(type));

export const layoutEngineFromConfig = (config: string | MermaidConfig): LayoutEngine => {
  try {
    const parsed = typeof config === 'string' ? (JSON.parse(config) as MermaidConfig) : config;
    return parsed.layout === 'elk' ? 'elk' : 'dagre';
  } catch {
    return 'dagre';
  }
};

const frontmatterLayout = (code: string): FrontmatterLayout | undefined => {
  const frontmatter = code.match(
    /^([^\S\n\r]*)(---[^\S\n\r]*\r?\n)([\s\S]*?)(\r?\n\1---[^\S\n\r]*(?=\r?\n|$))/
  );
  const body = frontmatter?.[3];
  if (!frontmatter || body === undefined) return undefined;

  const bodyStart = frontmatter[1].length + frontmatter[2].length;
  const document = parseDocument(body);
  if (document.errors.length > 0) return undefined;
  const layout = document.getIn(['config', 'layout'], true);
  if ((!isScalar(layout) && !isAlias(layout)) || !layout.range) return undefined;
  const resolvedLayout = isAlias(layout) ? layout.resolve(document) : layout;
  const engine =
    isScalar(resolvedLayout) && typeof resolvedLayout.value === 'string'
      ? resolvedLayout.value.toLowerCase()
      : '';
  if (engine !== 'dagre' && engine !== 'elk') return undefined;
  return {
    end: bodyStart + layout.range[1],
    engine,
    start: bodyStart + layout.range[0]
  };
};

export const layoutEngineFromDocument = (
  code: string,
  config: string | MermaidConfig
): LayoutEngine => frontmatterLayout(code)?.engine ?? layoutEngineFromConfig(config);

export const updateMermaidLayout = (configText: string, engine: LayoutEngine): string | null => {
  try {
    const parsed = configText.trim() ? JSON.parse(configText) : {};
    const config =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as MermaidConfig)
        : {};
    config.layout = engine;
    return JSON.stringify(config, undefined, 2);
  } catch {
    return null;
  }
};

export const updateMermaidDocumentLayout = (
  code: string,
  configText: string,
  engine: LayoutEngine
): { code: string; config: string } | null => {
  const config = updateMermaidLayout(configText, engine);
  if (!config) return null;
  const layout = frontmatterLayout(code);
  const currentValue = layout ? code.slice(layout.start, layout.end) : '';
  const quote = currentValue.match(/^(["']).*\1$/s)?.[1] ?? '';
  return {
    code: layout
      ? `${code.slice(0, layout.start)}${quote}${engine}${quote}${code.slice(layout.end)}`
      : code,
    config
  };
};

export const emptyVisualLayout = (engine: LayoutEngine): VisualLayout => ({
  engine,
  mode: 'auto',
  offsets: {}
});

const isOffset = (value: unknown): value is VisualLayoutOffset => {
  if (!value || typeof value !== 'object') return false;
  const offset = value as Partial<VisualLayoutOffset>;
  return (
    typeof offset.x === 'number' &&
    Number.isFinite(offset.x) &&
    typeof offset.y === 'number' &&
    Number.isFinite(offset.y)
  );
};

export const parseVisualLayout = (value: unknown): VisualLayout | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const layout = value as Partial<VisualLayout>;
  if (layout.engine !== 'dagre' && layout.engine !== 'elk') return undefined;
  if (layout.mode !== 'auto' && layout.mode !== 'manual') return undefined;
  if (!layout.offsets || typeof layout.offsets !== 'object') return undefined;
  const offsets = Object.fromEntries(
    Object.entries(layout.offsets).filter(([, offset]) => isOffset(offset))
  ) as Record<string, VisualLayoutOffset>;
  return { engine: layout.engine, mode: layout.mode, offsets };
};

const nodePrefixes = ['classId-', 'entity-', 'flowchart-', 'requirement-', 'state-'];

export const visualNodeKey = (element: Element): string | undefined => {
  const value = element.getAttribute('data-id') ?? element.getAttribute('id');
  if (!value) return undefined;
  const withoutIndex = value.replace(/-\d+$/, '');
  for (const prefix of nodePrefixes) {
    const index = withoutIndex.indexOf(prefix);
    if (index === 0 || (index > 0 && withoutIndex[index - 1] === '-')) {
      return withoutIndex.slice(index + prefix.length);
    }
  }
  return undefined;
};

export const visualNodeElements = (svg: SVGSVGElement): SVGGElement[] =>
  [...svg.querySelectorAll<SVGGElement>('g[id], g[data-id]')].filter((element) =>
    Boolean(visualNodeKey(element))
  );

export const visualTransform = (
  baseTransform: string,
  offset: VisualLayoutOffset | undefined
): string => {
  if (!offset || (offset.x === 0 && offset.y === 0)) return baseTransform;
  return `${baseTransform} translate(${offset.x} ${offset.y})`;
};
