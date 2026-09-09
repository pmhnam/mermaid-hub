<script lang="ts">
  import type { CollaborativeDocumentController } from './CollaborativeDocumentController';
  import type { RemotePreviewCursor } from './presence';

  interface RenderedCursor extends RemotePreviewCursor {
    flipX: boolean;
    flipY: boolean;
    left: number;
    top: number;
  }

  let {
    container,
    controller,
    cursors,
    revision
  }: {
    container: HTMLElement | null;
    controller: CollaborativeDocumentController;
    cursors: RemotePreviewCursor[];
    revision: string;
  } = $props();
  let rendered = $state<RenderedCursor[]>([]);
  let pendingFrame: number | null = null;

  const diagramElements = (): {
    svg: SVGSVGElement;
    viewport: SVGGraphicsElement;
  } | null => {
    const svg = container?.querySelector('#container svg');
    if (!(svg instanceof SVGSVGElement)) return null;
    return {
      svg,
      viewport: (svg.querySelector('.svg-pan-zoom_viewport') as SVGGraphicsElement | null) ?? svg
    };
  };

  const renderPositions = (
    visibleCursors: RemotePreviewCursor[],
    visibleRevision: string
  ): void => {
    const elements = diagramElements();
    const matrix = elements?.viewport.getScreenCTM();
    const bounds = container?.getBoundingClientRect();
    if (!elements || !matrix || !bounds) {
      rendered = [];
      return;
    }
    rendered = visibleCursors
      .filter((cursor) => cursor.revision === visibleRevision)
      .map((cursor) => {
        const point = elements.svg.createSVGPoint();
        point.x = cursor.x;
        point.y = cursor.y;
        const screen = point.matrixTransform(matrix);
        const left = screen.x - bounds.left;
        const top = screen.y - bounds.top;
        return {
          ...cursor,
          flipX: left > bounds.width - 180,
          flipY: top > bounds.height - 48,
          left,
          top
        };
      })
      .filter(
        ({ left, top }) =>
          left >= -24 && top >= -24 && left <= bounds.width + 24 && top <= bounds.height + 24
      );
  };

  const publish = (event: PointerEvent): void => {
    if (pendingFrame !== null) return;
    const { clientX, clientY } = event;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      const elements = diagramElements();
      const matrix = elements?.viewport.getScreenCTM();
      if (!matrix || !elements) return;
      const point = elements.svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      try {
        const diagramPoint = point.matrixTransform(matrix.inverse());
        controller.setPreviewCursor({ revision, x: diagramPoint.x, y: diagramPoint.y });
      } catch {
        controller.setPreviewCursor(null);
      }
    });
  };

  $effect(() => {
    if (!container) return;
    container.addEventListener('pointermove', publish);
    const clear = () => {
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
      controller.setPreviewCursor(null);
    };
    container.addEventListener('pointerleave', clear);
    container.addEventListener('pointercancel', clear);
    const clearWhenHidden = () => {
      if (document.hidden) clear();
    };
    document.addEventListener('visibilitychange', clearWhenHidden);
    return () => {
      container.removeEventListener('pointermove', publish);
      container.removeEventListener('pointerleave', clear);
      container.removeEventListener('pointercancel', clear);
      document.removeEventListener('visibilitychange', clearWhenHidden);
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
      clear();
    };
  });

  $effect(() => {
    const visibleCursors = cursors;
    const visibleRevision = revision;
    let frame: number;
    const update = () => {
      renderPositions(visibleCursors, visibleRevision);
      if (visibleCursors.length > 0) frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  });
</script>

<div class="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
  {#each rendered as cursor (cursor.clientId)}
    <div
      data-testid="preview-cursor"
      class="absolute flex items-start drop-shadow-sm"
      style={`transform: translate(${cursor.left}px, ${cursor.top}px); color: ${cursor.color}`}>
      <svg class="size-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 2.5v16.8l4.7-4.4 3.1 6.2 3-1.5-3.1-6.1 6.4-.8L4 2.5Z" />
      </svg>
      <span
        class={[
          'absolute top-4 left-1 max-w-40 truncate rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white',
          cursor.flipX && 'right-1 left-auto',
          cursor.flipY && 'top-auto bottom-4'
        ]}
        style={`background-color: ${cursor.color}`}>{cursor.displayName}</span>
    </div>
  {/each}
</div>
