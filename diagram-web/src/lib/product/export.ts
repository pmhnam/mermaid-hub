export type DiagramExportFormat = 'png' | 'svg' | 'pdf' | 'mmd';

export type DiagramExportBackground =
  | { type: 'white' }
  | { type: 'dark' }
  | { type: 'transparent' }
  | { color: string; type: 'custom' };

export interface DiagramExportOptions {
  background: DiagramExportBackground;
  code: string;
  config: string;
  format: DiagramExportFormat;
  scale?: number;
  svgElement: SVGSVGElement;
  title: string;
}

export interface DiagramExportResult {
  blob: Blob;
  filename: string;
}

interface SvgDimensions {
  height: number;
  minX: number;
  minY: number;
  width: number;
}

const DARK_BACKGROUND = '#111827';
const MAX_RASTER_DIMENSION = 8192;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const textEncoder = new TextEncoder();

const resolveBackground = (
  background: DiagramExportBackground,
  forceWhite = false
): string | null => {
  if (forceWhite || background.type === 'white') return '#ffffff';
  if (background.type === 'dark') return DARK_BACKGROUND;
  if (background.type === 'transparent') return null;
  const style = document.createElement('span').style;
  style.color = background.color;
  if (!style.color) throw new Error('Choose a valid background color.');
  return background.color;
};

const numericAttribute = (value: string | null): number | undefined => {
  if (!value || value.includes('%')) return undefined;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

export const getSvgDimensions = (svgElement: SVGSVGElement): SvgDimensions => {
  const viewBox = (svgElement.getAttribute('viewBox') ?? '').trim().split(/[ ,]+/).map(Number);
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { height: viewBox[3], minX: viewBox[0], minY: viewBox[1], width: viewBox[2] };
  }

  const width = numericAttribute(svgElement.getAttribute('width'));
  const height = numericAttribute(svgElement.getAttribute('height'));
  if (width && height) return { height, minX: 0, minY: 0, width };

  const bounds = svgElement.getBoundingClientRect();
  if (bounds.width > 0 && bounds.height > 0) {
    return { height: bounds.height, minX: 0, minY: 0, width: bounds.width };
  }

  throw new Error('The rendered diagram has no measurable size.');
};

export const serializeDiagramSvg = (
  svgElement: SVGSVGElement,
  background: DiagramExportBackground,
  forceWhite = false
): string => {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  const dimensions = getSvgDimensions(svgElement);
  const color = resolveBackground(background, forceWhite);

  clone.setAttribute('xmlns', SVG_NAMESPACE);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute(
    'viewBox',
    `${dimensions.minX} ${dimensions.minY} ${dimensions.width} ${dimensions.height}`
  );
  clone.style.backgroundColor = color ?? 'transparent';
  clone.querySelectorAll('.svg-pan-zoom_viewport').forEach((viewport) => {
    viewport.removeAttribute('transform');
  });

  if (color) {
    const rectangle = document.createElementNS(SVG_NAMESPACE, 'rect');
    rectangle.setAttribute('data-export-background', 'true');
    rectangle.setAttribute('fill', color);
    rectangle.setAttribute('height', String(dimensions.height));
    rectangle.setAttribute('width', String(dimensions.width));
    rectangle.setAttribute('x', String(dimensions.minX));
    rectangle.setAttribute('y', String(dimensions.minY));
    clone.insertBefore(rectangle, clone.firstChild);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
};

export const buildMermaidFile = (code: string, config: string): string => {
  const trimmedConfig = config.trim();
  if (!trimmedConfig) return code;

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(trimmedConfig);
  } catch {
    throw new Error('The current Mermaid configuration is not valid JSON.');
  }

  return `---\nconfig: ${JSON.stringify(parsedConfig)}\n---\n${code}`;
};

export const createExportFilename = (title: string, format: DiagramExportFormat): string => {
  const baseName = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 80);
  return `${baseName || 'mermaid-diagram'}.${format}`;
};

const blobFromCanvas = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('The browser could not encode the image.')),
      type,
      quality
    );
  });

const loadSvgImage = (svg: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const image = new Image();
    image.addEventListener('load', () => {
      URL.revokeObjectURL(url);
      resolve(image);
    });
    image.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('The rendered SVG could not be loaded for export.'));
    });
    image.src = url;
  });

const renderSvgToCanvas = async (
  svgElement: SVGSVGElement,
  background: DiagramExportBackground,
  scale: number,
  forceWhite = false
): Promise<HTMLCanvasElement> => {
  const dimensions = getSvgDimensions(svgElement);
  const safeScale = Math.max(
    0.1,
    Math.min(
      scale,
      MAX_RASTER_DIMENSION / dimensions.width,
      MAX_RASTER_DIMENSION / dimensions.height
    )
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(dimensions.width * safeScale));
  canvas.height = Math.max(1, Math.round(dimensions.height * safeScale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas export is not supported by this browser.');

  const color = resolveBackground(background, forceWhite);
  if (color) {
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const image = await loadSvgImage(serializeDiagramSvg(svgElement, background, forceWhite));
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const joinBytes = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

export const createPdfFromJpeg = (
  jpeg: Uint8Array,
  pixelWidth: number,
  pixelHeight: number,
  displayWidth = pixelWidth,
  displayHeight = pixelHeight
): Blob => {
  const pageWidth = (displayWidth * 72) / 96;
  const pageHeight = (displayHeight * 72) / 96;
  const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
  const objects = [
    textEncoder.encode('<< /Type /Catalog /Pages 2 0 R >>'),
    textEncoder.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    textEncoder.encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
    ),
    joinBytes([
      textEncoder.encode(
        `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`
      ),
      jpeg,
      textEncoder.encode('\nendstream')
    ]),
    textEncoder.encode(
      `<< /Length ${textEncoder.encode(content).byteLength} >>\nstream\n${content}endstream`
    )
  ];
  const parts = [textEncoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  const offsets = [0];
  let byteLength = parts[0].byteLength;

  objects.forEach((object, index) => {
    offsets.push(byteLength);
    const part = joinBytes([
      textEncoder.encode(`${index + 1} 0 obj\n`),
      object,
      textEncoder.encode('\nendobj\n')
    ]);
    parts.push(part);
    byteLength += part.byteLength;
  });

  const xrefOffset = byteLength;
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    '%%EOF\n'
  ].join('\n');
  parts.push(textEncoder.encode(xref));

  return new Blob([joinBytes(parts)], { type: 'application/pdf' });
};

export const exportDiagram = async (
  options: DiagramExportOptions
): Promise<DiagramExportResult> => {
  const filename = createExportFilename(options.title, options.format);
  if (options.format === 'mmd') {
    return {
      blob: new Blob([buildMermaidFile(options.code, options.config)], { type: 'text/plain' }),
      filename
    };
  }

  if (options.format === 'svg') {
    return {
      blob: new Blob([serializeDiagramSvg(options.svgElement, options.background)], {
        type: 'image/svg+xml'
      }),
      filename
    };
  }

  const forceWhite = options.format === 'pdf';
  const canvas = await renderSvgToCanvas(
    options.svgElement,
    options.background,
    options.scale ?? (forceWhite ? 3 : 2),
    forceWhite
  );
  if (options.format === 'png') {
    return { blob: await blobFromCanvas(canvas, 'image/png'), filename };
  }

  const jpeg = new Uint8Array(
    await (await blobFromCanvas(canvas, 'image/jpeg', 0.94)).arrayBuffer()
  );
  const dimensions = getSvgDimensions(options.svgElement);
  return {
    blob: createPdfFromJpeg(jpeg, canvas.width, canvas.height, dimensions.width, dimensions.height),
    filename
  };
};

export const downloadDiagramExport = ({ blob, filename }: DiagramExportResult): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.download = filename;
  anchor.href = url;
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
