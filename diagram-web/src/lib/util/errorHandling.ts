import type { ErrorHash, SourceRange } from '$/types';

// Function to find the line number with the most characters in common with the error
export function findMostRelevantLineNumber(errorLineText: string, code: string): number {
  const codeLines = code.split('\n');
  let mostRelevantLineNumber = -1;
  let maxCommonLength = 0;

  for (const [i, line] of codeLines.entries()) {
    let commonLength = 0;
    for (let j = 0; j <= errorLineText.length; j++) {
      for (let k = j + 1; k <= errorLineText.length; k++) {
        const sub = errorLineText.slice(j, k);
        if (line.includes(sub)) {
          commonLength = Math.max(commonLength, sub.length);
        }
      }
    }
    if (commonLength > maxCommonLength) {
      maxCommonLength = commonLength;
      mostRelevantLineNumber = i + 1; // Line numbers start from 1
    }
  }
  return mostRelevantLineNumber;
}

// Function to replace the incorrect line number in the error message
export function replaceLineNumberInErrorMessage(
  errorMessage: string,
  realLineNumber: number
): string {
  const regexParseError = /Parse error on line (\d+):/;
  const regexLexError = /Lexical error on line (\d+)/;
  return errorMessage
    .replace(regexParseError, `Parse error on line ${realLineNumber}:`)
    .replace(regexLexError, `Lexical error on line ${realLineNumber}:`);
}

export function extractErrorLineText(errorMessage: string): string {
  const regex = /Error: Parse error on line \d+:\n(.+)\n+/;
  const match = errorMessage.match(regex);
  if (match) {
    return match[1].slice(3);
  }

  const regexLex = /Error: Lexical error on line \d+. Unrecognized text.\n(.+)\n-+/;
  const matchLex = errorMessage.match(regexLex);
  return matchLex ? matchLex[1].slice(3) : '';
}

const lineOffsets = (code: string): number[] => {
  const offsets = [0];
  for (let index = code.indexOf('\n'); index !== -1; index = code.indexOf('\n', index + 1)) {
    offsets.push(index + 1);
  }
  return offsets;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

/** Convert Mermaid's 1-based lines and 0-based columns to source offsets. */
export function sourceRangeFromError(
  error: unknown,
  code: string,
  errorMessage: string
): SourceRange | undefined {
  const lines = code.split('\n');
  const offsets = lineOffsets(code);
  const hash = error && typeof error === 'object' && 'hash' in error ? error.hash : undefined;
  const location = (hash as ErrorHash | undefined)?.loc;
  const hasLocation = location !== undefined;
  const reportedLine = location?.first_line;
  const relevantLine = findMostRelevantLineNumber(extractErrorLineText(errorMessage), code);
  const firstLine = clamp(relevantLine > 0 ? relevantLine : (reportedLine ?? 1), 1, lines.length);
  const lineDelta = reportedLine && relevantLine > 0 ? firstLine - reportedLine : 0;
  const lastLine = clamp(
    (location?.last_line ?? reportedLine ?? firstLine) + lineDelta,
    firstLine,
    lines.length
  );
  const firstColumn = clamp(
    !hasLocation || (relevantLine > 0 && reportedLine !== relevantLine)
      ? 0
      : (location?.first_column ?? 0),
    0,
    lines[firstLine - 1].replace(/\r$/, '').length
  );
  const lastColumn = clamp(
    relevantLine > 0 && reportedLine !== relevantLine
      ? lines[lastLine - 1].replace(/\r$/, '').length
      : !hasLocation
        ? lines[lastLine - 1].replace(/\r$/, '').length
        : (location?.last_column ?? firstColumn + 1),
    firstColumn + 1,
    lines[lastLine - 1].replace(/\r$/, '').length || firstColumn + 1
  );
  const start = offsets[firstLine - 1] + firstColumn;
  const end = Math.max(start + 1, offsets[lastLine - 1] + lastColumn);

  return { end: Math.min(end, code.length), start: Math.min(start, code.length) };
}
