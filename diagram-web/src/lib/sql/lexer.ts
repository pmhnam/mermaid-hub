import type { SqlDialect, SqlName } from './types';

export interface Token {
  kind: 'word' | 'identifier' | 'string' | 'symbol';
  value: string;
  raw: string;
  start: number;
  end: number;
}
export class SqlParseError extends Error {
  constructor(
    message: string,
    readonly offset?: number
  ) {
    super(message);
    this.name = 'SqlParseError';
  }
}

/** A scanner, rather than splitting on commas/semicolons: SQL strings, comments,
 * dollar-quoted bodies and nested expressions can all contain those characters. */
export const tokenize = (sql: string, dialect: SqlDialect): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }
    if (
      sql.startsWith('--', i) ||
      (dialect === 'mysql' && sql[i] === '#') ||
      (sql[i] === '\\' && (i === 0 || sql[i - 1] === '\n'))
    ) {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const start = i;
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw new SqlParseError('Unterminated SQL comment', start);
      continue;
    }
    const start = i;
    if (sql[i] === '$' && dialect === 'postgresql') {
      const delimiter = sql.slice(i).match(/^\$(?:[a-zA-Z_][\w]*)?\$/)?.[0];
      if (delimiter) {
        const end = sql.indexOf(delimiter, i + delimiter.length);
        if (end < 0) throw new SqlParseError('Unterminated dollar-quoted SQL string', start);
        i = end + delimiter.length;
        tokens.push({
          end: i,
          kind: 'string',
          raw: sql.slice(start, i),
          start,
          value: sql.slice(start + delimiter.length, end)
        });
        continue;
      }
    }
    if (["'", '"', '`'].includes(sql[i])) {
      const quote = sql[i++];
      let value = '';
      let closed = false;
      const escapes =
        dialect === 'mysql' ||
        (tokens.at(-1)?.raw.toUpperCase() === 'E' && tokens.at(-1)?.end === start);
      while (i < sql.length) {
        if (sql[i] === quote) {
          i++;
          if (sql[i] === quote) {
            value += quote;
            i++;
            continue;
          }
          closed = true;
          break;
        }
        if (escapes && sql[i] === '\\' && i + 1 < sql.length) {
          const c = sql[++i];
          value += ({ n: '\n', r: '\r', t: '\t', '0': '\0' } as Record<string, string>)[c] ?? c;
          i++;
        } else value += sql[i++];
      }
      if (!closed) throw new SqlParseError('Unterminated quoted identifier or string', start);
      tokens.push({
        end: i,
        kind: quote === "'" ? 'string' : 'identifier',
        raw: sql.slice(start, i),
        start,
        value
      });
      continue;
    }
    if (/[\p{L}\p{N}_$]/u.test(sql[i])) {
      i++;
      while (i < sql.length && /[\p{L}\p{N}_$]/u.test(sql[i])) i++;
      tokens.push({
        end: i,
        kind: 'word',
        raw: sql.slice(start, i),
        start,
        value: sql.slice(start, i)
      });
      continue;
    }
    i += sql.startsWith('::', i) ? 2 : 1;
    tokens.push({
      end: i,
      kind: 'symbol',
      raw: sql.slice(start, i),
      start,
      value: sql.slice(start, i)
    });
  }
  return tokens;
};

export const keyword = (token: Token | undefined, value: string): boolean =>
  token?.kind === 'word' && token.value.toUpperCase() === value;
export const textOf = (tokens: Token[], source: string): string =>
  tokens.length ? source.slice(tokens[0].start, tokens[tokens.length - 1].end).trim() : '';

export const splitTopLevel = (tokens: Token[], separator: ',' | ';'): Token[][] => {
  const result: Token[][] = [];
  let depth = 0;
  let bracket = 0;
  let start = 0;
  tokens.forEach((token, i) => {
    if (token.kind !== 'symbol') return;
    if (token.value === '(') depth++;
    if (token.value === ')') {
      depth--;
      if (depth < 0) throw new SqlParseError('Unexpected closing parenthesis', token.start);
    }
    if (token.value === '[') bracket++;
    if (token.value === ']') bracket--;
    if (token.value === separator && !depth && !bracket) {
      if (i > start) result.push(tokens.slice(start, i));
      start = i + 1;
    }
  });
  if (depth || bracket) throw new SqlParseError('Unbalanced SQL expression', tokens[start]?.start);
  if (start < tokens.length) result.push(tokens.slice(start));
  return result;
};

export class Cursor {
  position = 0;
  constructor(
    readonly tokens: Token[],
    readonly dialect: SqlDialect,
    readonly source: string
  ) {}
  get done(): boolean {
    return this.position >= this.tokens.length;
  }
  get current(): Token | undefined {
    return this.tokens[this.position];
  }
  is(word: string): boolean {
    return keyword(this.current, word);
  }
  take(word: string): boolean {
    if (!this.is(word)) return false;
    this.position++;
    return true;
  }
  symbol(value: string): boolean {
    if (this.current?.kind !== 'symbol' || this.current.value !== value) return false;
    this.position++;
    return true;
  }
  require(word: string): void {
    if (!this.take(word)) throw new SqlParseError(`Expected ${word}`, this.current?.start);
  }
  identifier(): string {
    const token = this.current;
    if (!token || !['word', 'identifier'].includes(token.kind))
      throw new SqlParseError('Expected an SQL identifier', token?.start);
    this.position++;
    return this.dialect === 'postgresql' && token.kind === 'word'
      ? token.value.toLowerCase()
      : token.value;
  }
  name(defaultSchema?: string): SqlName {
    const first = this.identifier();
    if (this.symbol('.')) return { name: this.identifier(), schema: first };
    return { name: first, ...(defaultSchema ? { schema: defaultSchema } : {}) };
  }
  string(): string {
    this.take('E');
    const token = this.current;
    if (
      !token ||
      (token.kind !== 'string' && !(this.dialect === 'mysql' && token.raw.startsWith('"')))
    )
      throw new SqlParseError('Expected a quoted SQL string', token?.start);
    this.position++;
    return token.value;
  }
  group(): Token[] {
    if (!this.symbol('('))
      throw new SqlParseError('Expected opening parenthesis', this.current?.start);
    const start = this.position;
    let depth = 1;
    while (!this.done) {
      const token = this.tokens[this.position++];
      if (token.kind !== 'symbol') continue;
      if (token.value === '(') depth++;
      if (token.value === ')' && --depth === 0) return this.tokens.slice(start, this.position - 1);
    }
    throw new SqlParseError('Unclosed parenthesis', this.tokens[start - 1].start);
  }
  columns(): string[] {
    return splitTopLevel(this.group(), ',').map((tokens) => {
      const cursor = new Cursor(tokens, this.dialect, this.source);
      const name = cursor.identifier();
      if (!cursor.done)
        throw new SqlParseError(
          'Expected a simple column name in constraint',
          cursor.current?.start
        );
      return name;
    });
  }
  rest(): string {
    return textOf(this.tokens.slice(this.position), this.source);
  }
}
