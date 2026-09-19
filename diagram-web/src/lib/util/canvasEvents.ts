// Editor-to-canvas selections are local UI state, never collaborative document edits.
export const SOURCE_SELECTION_EVENT = 'mermaid-source-selection';
export interface SourceCursor {
  code: string;
  lineNumber: number;
  column: number;
}
export const publishSourceCursor = (cursor: SourceCursor): void => {
  window.dispatchEvent(new CustomEvent(SOURCE_SELECTION_EVENT, { detail: cursor }));
};
