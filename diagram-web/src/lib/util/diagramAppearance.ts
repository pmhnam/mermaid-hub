import type { MermaidConfig } from 'mermaid';
import { isMap, parseDocument } from 'yaml';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Appearance is local to the viewer, not an edit to the shared diagram. */
export const diagramForAppearance = (
  code: string,
  config: MermaidConfig,
  appearance?: 'light' | 'dark'
): { code: string; config: MermaidConfig } => {
  if (appearance !== 'dark') return { code, config };
  const renderedConfig: MermaidConfig = {
    ...config,
    theme: 'dark',
    themeVariables: { ...record(config.themeVariables), darkMode: true }
  };
  // Mermaid frontmatter wins over initialize(). Override only the render copy,
  // keeping the original source/offsets for editing, history and collaboration.
  const frontmatter = code.match(
    /^(\uFEFF?\s*---[^\S\r\n]*\r?\n)([\s\S]*?)(\r?\n[^\S\r\n]*---[^\S\r\n]*(?=\r?\n|$))/
  );
  if (!frontmatter) return { code, config: renderedConfig };
  const document = parseDocument(frontmatter[2]);
  if (document.errors.length || !isMap(document.contents)) return { code, config: renderedConfig };
  const metadata = record(document.toJS());
  const diagramConfig = record(metadata.config);
  document.set('config', {
    ...diagramConfig,
    theme: 'dark',
    themeVariables: { ...record(diagramConfig.themeVariables), darkMode: true }
  });
  return {
    code: `${frontmatter[1]}${document.toString().trimEnd()}${frontmatter[3]}${code.slice(frontmatter[0].length)}`,
    config: renderedConfig
  };
};
