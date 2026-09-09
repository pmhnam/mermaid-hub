import { describe, expect, it } from 'vitest';
import {
  buildMermaidFile,
  createExportFilename,
  createPdfFromJpeg,
  getSvgDimensions,
  serializeDiagramSvg
} from './export';

const createSvg = (): SVGSVGElement => {
  const wrapper = document.createElement('div');
  wrapper.innerHTML =
    '<svg viewBox="10 20 300 150"><g id="content" class="svg-pan-zoom_viewport" transform="matrix(2,0,0,2,40,50)"><text>Diagram</text></g></svg>';
  return wrapper.firstElementChild as SVGSVGElement;
};

describe('product diagram export', () => {
  it('gets dimensions from the viewBox', () => {
    expect(getSvgDimensions(createSvg())).toEqual({ height: 150, minX: 10, minY: 20, width: 300 });
  });

  it('serializes a clone with a background without changing the rendered SVG', () => {
    const svg = createSvg();
    const serialized = serializeDiagramSvg(svg, { color: '#123456', type: 'custom' });

    expect(serialized).toContain('data-export-background="true"');
    expect(serialized).toContain('fill="#123456"');
    expect(serialized).toContain('viewBox="10 20 300 150"');
    expect(serialized).not.toContain('transform="matrix(2,0,0,2,40,50)"');
    expect(svg.querySelector('[data-export-background]')).toBeNull();
    expect(svg.querySelector('#content')?.getAttribute('transform')).toBe('matrix(2,0,0,2,40,50)');
    expect(svg.getAttribute('style')).toBeNull();
  });

  it('leaves transparent SVG exports without a background rectangle', () => {
    expect(serializeDiagramSvg(createSvg(), { type: 'transparent' })).not.toContain(
      'data-export-background'
    );
  });

  it('uses exact white and black backgrounds', () => {
    expect(serializeDiagramSvg(createSvg(), { type: 'white' })).toContain('fill="#ffffff"');
    expect(serializeDiagramSvg(createSvg(), { type: 'black' })).toContain('fill="#000000"');
  });

  it('writes config and code to a Mermaid file', () => {
    expect(buildMermaidFile('flowchart LR\nA-->B', '{ "theme": "dark" }')).toBe(
      '---\nconfig: {"theme":"dark"}\n---\nflowchart LR\nA-->B'
    );
  });

  it('rejects invalid Mermaid config instead of exporting stale or malformed data', () => {
    expect(() => buildMermaidFile('flowchart LR', '{')).toThrow(
      'The current Mermaid configuration is not valid JSON.'
    );
  });

  it('creates safe, predictable filenames', () => {
    expect(createExportFilename('  Quarterly Plan / 2026  ', 'svg')).toBe(
      'quarterly-plan-2026.svg'
    );
    expect(createExportFilename('東京', 'mmd')).toBe('mermaid-diagram.mmd');
  });

  it('creates a minimal PDF containing the JPEG image stream', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = createPdfFromJpeg(jpeg, 600, 300, 200, 100);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const text = new TextDecoder().decode(bytes);

    expect(pdf.type).toBe('application/pdf');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/Width 600 /Height 300');
    expect(text).toContain('/MediaBox [0 0 150 75]');
    expect(text).toContain('xref');
    expect(text.endsWith('%%EOF\n')).toBe(true);
  });
});
