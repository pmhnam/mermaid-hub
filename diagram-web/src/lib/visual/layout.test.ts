import { describe, expect, it } from 'vitest';
import {
  isVisualLayoutSupported,
  layoutEngineFromConfig,
  parseVisualLayout,
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
});
