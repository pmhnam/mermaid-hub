import { parseDocument } from 'yaml';
import { buildSourceNavigationIndex } from '$/util/sourceNavigationIndex';
import type { CanvasDocument } from './canvasModel.svelte';

export const replaceSourceRange = (
  code: string,
  start: number,
  end: number,
  text: string
): string => code.slice(0, start) + text + code.slice(end);

export const renameErEntity = (code: string, oldName: string, name: string): string => {
  if (!name.trim() || /["\\\r\n]/.test(name))
    throw new Error('Use a non-empty name without quotes or line breaks.');
  const index = buildSourceNavigationIndex(code, 'er');
  name = name.trim();
  const identifiers: { start: number; text: string }[] = [];
  for (const range of index.declarations.values()) {
    const match = code.slice(range.start, range.end).match(/^("[^"\n]+"|[\w.-]+)/);
    if (match) identifiers.push({ start: range.start, text: match[0] });
  }
  for (const range of index.edges) {
    const match = code
      .slice(range.start, range.end)
      .match(/^("[^"\n]+"|[\w.-]+)(\s+[\s\S]*?\s+)("[^"\n]+"|[\w.-]+)\s*:/);
    if (!match) continue;
    identifiers.push(
      { start: range.start, text: match[1] },
      { start: range.start + match[1].length + match[2].length, text: match[3] }
    );
  }
  const unquote = (value: string): string => value.replace(/^"|"$/g, '');
  if (name !== oldName && identifiers.some((id) => unquote(id.text) === name))
    throw new Error('An entity with this name already exists.');
  const edits = new Map<number, { end: number; text: string }>();
  for (const identifier of identifiers) {
    if (unquote(identifier.text) === oldName)
      edits.set(identifier.start, {
        end: identifier.start + identifier.text.length,
        text: `"${name}"`
      });
  }
  for (const match of code.matchAll(/^(\s*(?:style|class)\s+)([^\s]+)(\s+)/gm)) {
    const names = match[2].split(',');
    if (!names.includes(oldName)) continue;
    if (!/^[\w.-]+$/.test(name))
      throw new Error(
        'Styled entity names must contain only letters, digits, underscores, dots or hyphens.'
      );
    const start = match.index + match[1].length;
    edits.set(start, {
      end: start + match[2].length,
      text: names.map((id) => (id === oldName ? name : id)).join(',')
    });
  }
  for (const [start, edit] of [...edits].sort((a, b) => b[0] - a[0]))
    code = replaceSourceRange(code, start, edit.end, edit.text);
  return code;
};

export const themeDocument = (
  document: CanvasDocument,
  palette: 'default' | 'dark' | 'forest' | 'neutral'
): CanvasDocument => {
  const frontmatter = document.code.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  const config = { ...JSON.parse(document.config), theme: palette };
  let code = document.code;
  if (frontmatter) {
    const yaml = parseDocument(frontmatter[2]);
    if (yaml.errors.length) throw new Error('Invalid frontmatter');
    yaml.setIn(['config', 'theme'], palette);
    code = `---\n${yaml.toString()}---${code.slice(frontmatter[0].length)}`;
  }
  return { code, config: JSON.stringify(config, null, 2) };
};
