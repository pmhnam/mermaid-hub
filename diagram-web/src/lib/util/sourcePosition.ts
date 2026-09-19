// Source offsets refer to the rendered document; editors may normalize its line endings.
export const sourcePosition = (
  code: string,
  offset: number
): { column: number; lineNumber: number } => {
  const before = code.slice(0, Math.max(0, Math.min(offset, code.length)));
  const lines = before.split(/\r\n|\r|\n/);
  return { column: (lines.at(-1)?.length ?? 0) + 1, lineNumber: lines.length };
};
