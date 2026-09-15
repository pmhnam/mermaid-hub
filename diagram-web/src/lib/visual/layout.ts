import type { MermaidConfig } from 'mermaid';

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

export const updateMermaidLayout = (configText: string, engine: LayoutEngine): string | null => {
  try {
    const config = JSON.parse(configText) as MermaidConfig;
    config.layout = engine;
    return JSON.stringify(config, undefined, 2);
  } catch {
    return null;
  }
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
  const prefix = nodePrefixes.find((candidate) => withoutIndex.startsWith(candidate));
  return prefix ? withoutIndex.slice(prefix.length) : undefined;
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
