/** Space temporarily turns entity dragging into canvas panning. */
export const setupCanvasShortcuts = (
  svg: SVGElement,
  setSpacePanning: (enabled: boolean) => void
): (() => void) => {
  const editable = (target: EventTarget | null): boolean =>
    target instanceof Element &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
  const set = (enabled: boolean): void => {
    setSpacePanning(enabled);
    svg.classList.toggle('space-pan', enabled);
    if (!enabled) svg.classList.remove('space-panning');
  };
  const down = (event: KeyboardEvent): void => {
    if (
      event.code !== 'Space' ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      editable(event.target) ||
      !(svg.matches(':hover') || svg.contains(document.activeElement))
    )
      return;
    event.preventDefault();
    set(true);
  };
  const up = (event: KeyboardEvent): void => {
    if (event.code === 'Space') set(false);
  };
  const reset = (): void => set(false);
  const pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    // Clicking the canvas leaves the code editor, allowing subsequent Space drags.
    svg.focus({ preventScroll: true });
    if (svg.classList.contains('space-pan')) svg.classList.add('space-panning');
  };
  const pointerUp = (): void => svg.classList.remove('space-panning');
  svg.setAttribute('tabindex', '0');
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', reset);
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', reset);
  document.addEventListener('visibilitychange', reset);
  svg.addEventListener('pointerdown', pointerDown, true);
  return () => {
    reset();
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', reset);
    window.removeEventListener('pointerup', pointerUp);
    window.removeEventListener('pointercancel', reset);
    document.removeEventListener('visibilitychange', reset);
    svg.removeEventListener('pointerdown', pointerDown, true);
  };
};
