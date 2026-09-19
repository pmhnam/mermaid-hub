import { describe, expect, it } from 'vitest';
import {
  isVisualLayoutSupported,
  layoutEngineFromConfig,
  layoutEngineFromDocument,
  parseVisualLayout,
  updateMermaidDocumentLayout,
  updateMermaidLayout,
  visualNodeKey
} from './layout';

describe('visual layout', () => {
  it('maps the editor layout names to Mermaid engines', () => {
    expect(layoutEngineFromConfig('{"layout":"elk"}')).toBe('elk');
    expect(layoutEngineFromConfig('{"theme":"default"}')).toBe('dagre');
    expect(updateMermaidLayout('{"theme":"dark"}', 'elk')).toBe(
      '{\n  "theme": "dark",\n  "layout": "elk"\n}'
    );
    expect(updateMermaidLayout('', 'elk')).toBe('{\n  "layout": "elk"\n}');
  });

  it('reads and updates a layout overridden by frontmatter', () => {
    const code = [
      '---',
      'title: Catalog',
      'config:',
      '  theme: dark',
      '  layout: elk # elk remains available',
      '---',
      'erDiagram'
    ].join('\n');

    expect(layoutEngineFromDocument(code, '{"layout":"dagre"}')).toBe('elk');
    expect(updateMermaidDocumentLayout(code, '{"theme":"dark"}', 'dagre')).toEqual({
      code: code.replace('layout: elk', 'layout: dagre'),
      config: '{\n  "theme": "dark",\n  "layout": "dagre"\n}'
    });
  });

  it('updates inline frontmatter without rewriting unrelated formatting', () => {
    const code = '---\r\nconfig: {"theme":"forest", "layout":"elk"}\r\n---\r\nflowchart LR';
    const updated = updateMermaidDocumentLayout(code, '{}', 'dagre');

    expect(updated?.code).toBe(
      '---\r\nconfig: {"theme":"forest", "layout":"dagre"}\r\n---\r\nflowchart LR'
    );
    expect(layoutEngineFromDocument(updated?.code ?? '', updated?.config ?? '')).toBe('dagre');
  });

  it('supports multiline flow-style frontmatter config', () => {
    const code = [
      '---',
      'config: {',
      '  layout: elk,',
      '  theme: dark',
      '}',
      '---',
      'flowchart LR'
    ].join('\n');

    expect(layoutEngineFromDocument(code, '{"layout":"dagre"}')).toBe('elk');
    expect(updateMermaidDocumentLayout(code, '{}', 'dagre')?.code).toBe(
      code.replace('layout: elk', 'layout: dagre')
    );
  });

  it('does not treat comments or nested strings as frontmatter layout', () => {
    const comment = '---\nconfig: # layout: elk\n  theme: dark\n---\nflowchart LR';
    const nested = [
      '---',
      'config: { themeVariables: { noteTextColor: "layout: elk" } }',
      '---',
      'flowchart LR'
    ].join('\n');

    expect(layoutEngineFromDocument(comment, '{"layout":"dagre"}')).toBe('dagre');
    expect(layoutEngineFromDocument(nested, '{"layout":"dagre"}')).toBe('dagre');
    expect(updateMermaidDocumentLayout(comment, '{}', 'elk')?.code).toBe(comment);
    expect(updateMermaidDocumentLayout(nested, '{}', 'elk')?.code).toBe(nested);
  });

  it('resolves and replaces an aliased frontmatter layout', () => {
    const code = [
      '---',
      'engine: &engine elk',
      'config:',
      '  layout: *engine',
      '---',
      'flowchart LR'
    ].join('\n');

    expect(layoutEngineFromDocument(code, '{"layout":"dagre"}')).toBe('elk');
    expect(updateMermaidDocumentLayout(code, '{}', 'dagre')?.code).toBe(
      code.replace('layout: *engine', 'layout: dagre')
    );
  });

  it('leaves source without a frontmatter layout unchanged', () => {
    const code = '---\nconfig:\n  theme: dark\n---\nflowchart LR';
    expect(updateMermaidDocumentLayout(code, '{}', 'elk')?.code).toBe(code);
  });

  it('validates persisted offsets without accepting invalid coordinates', () => {
    expect(
      parseVisualLayout({
        engine: 'dagre',
        mode: 'manual',
        offsets: { A: { x: 12, y: -4 }, broken: { x: Number.NaN, y: 2 } }
      })
    ).toEqual({ engine: 'dagre', mode: 'manual', offsets: { A: { x: 12, y: -4 } } });
    expect(parseVisualLayout({ engine: 'unknown', mode: 'manual', offsets: {} })).toBeUndefined();
  });

  it('recognizes supported diagram types and stable SVG node keys', () => {
    expect(isVisualLayoutSupported('flowchart-v2')).toBe(true);
    expect(isVisualLayoutSupported('sequence')).toBe(false);
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    node.setAttribute('id', 'entity-CUSTOMER-0');
    expect(visualNodeKey(node)).toBe('CUSTOMER');
  });
  it('round-trips relationship bends and discards malformed routes', () => {
    const points = [
      { x: -120, y: 200 },
      { x: 10, y: 300 }
    ];
    const parsed = parseVisualLayout({
      engine: 'elk',
      mode: 'manual',
      offsets: {},
      edgeRoutes: {
        valid: points,
        invalid: [{ x: Infinity, y: 0 }],
        empty: [],
        oversized: Array.from({ length: 33 }, () => ({ x: 1, y: 1 }))
      }
    });
    expect(parsed?.edgeRoutes).toEqual({ valid: points });
  });
});
