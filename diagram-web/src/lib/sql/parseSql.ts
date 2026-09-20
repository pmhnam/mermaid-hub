import {
  Cursor,
  keyword,
  splitTopLevel,
  SqlParseError,
  textOf,
  tokenize,
  type Token
} from './lexer';
import {
  displayName,
  nameKey,
  type ReferentialAction,
  type SqlColumn,
  type SqlConstraint,
  type SqlDialect,
  type SqlIndex,
  type SqlName,
  type SqlResult,
  type SqlSchema,
  type SqlTable
} from './types';

const attributeWords = new Set([
  'NOT',
  'NULL',
  'DEFAULT',
  'PRIMARY',
  'UNIQUE',
  'REFERENCES',
  'CHECK',
  'CONSTRAINT',
  'AUTO_INCREMENT',
  'GENERATED',
  'AS',
  'COMMENT',
  'COLLATE',
  'ON',
  'CHARSET',
  'INVISIBLE',
  'VISIBLE',
  'STORAGE',
  'COMPRESSION'
]);
const atAttribute = (tokens: Token[], index: number): boolean =>
  tokens[index]?.kind === 'word' &&
  (attributeWords.has(tokens[index].value.toUpperCase()) ||
    (keyword(tokens[index], 'CHARACTER') && keyword(tokens[index + 1], 'SET')));

const expressionUntilAttribute = (cursor: Cursor): string => {
  const start = cursor.position;
  let depth = 0,
    cases = 0;
  while (!cursor.done) {
    const token = cursor.current;
    if (!depth && !cases && cursor.position > start && atAttribute(cursor.tokens, cursor.position))
      break;
    if (keyword(token, 'CASE')) cases++;
    if (keyword(token, 'END')) cases--;
    if (token?.kind === 'symbol' && ['(', '['].includes(token.value)) depth++;
    if (token?.kind === 'symbol' && [')', ']'].includes(token.value)) depth--;
    cursor.position++;
  }
  const expression = textOf(cursor.tokens.slice(start, cursor.position), cursor.source);
  if (!expression) throw new SqlParseError('Missing SQL expression', cursor.current?.start);
  return expression;
};

const action = (cursor: Cursor): ReferentialAction => {
  if (cursor.take('CASCADE')) return 'CASCADE';
  if (cursor.take('RESTRICT')) return 'RESTRICT';
  if (cursor.take('NO')) {
    cursor.require('ACTION');
    return 'NO ACTION';
  }
  if (cursor.take('SET')) {
    if (cursor.take('NULL')) return 'SET NULL';
    cursor.require('DEFAULT');
    return 'SET DEFAULT';
  }
  throw new SqlParseError('Unsupported referential action', cursor.current?.start);
};

const foreignOptions = (cursor: Cursor, constraint: SqlConstraint): void => {
  while (!cursor.done) {
    if (cursor.take('ON')) {
      const operation = cursor.take('DELETE')
        ? 'onDelete'
        : cursor.take('UPDATE')
          ? 'onUpdate'
          : undefined;
      if (!operation)
        throw new SqlParseError('Expected ON DELETE or ON UPDATE', cursor.current?.start);
      constraint[operation] = action(cursor);
    } else if (cursor.take('MATCH')) {
      constraint.match = cursor.take('FULL') ? 'FULL' : (cursor.require('SIMPLE'), 'SIMPLE');
    } else if (cursor.take('DEFERRABLE')) constraint.deferrable = true;
    else if (cursor.is('NOT') && keyword(cursor.tokens[cursor.position + 1], 'DEFERRABLE')) {
      cursor.position += 2;
      constraint.deferrable = false;
    } else if (cursor.take('INITIALLY'))
      constraint.initiallyDeferred =
        cursor.take('DEFERRED') || (cursor.require('IMMEDIATE'), false);
    else break;
  }
};

const reference = (cursor: Cursor, columns: string[], schema?: string): SqlConstraint => {
  const references = cursor.name(schema);
  const referencedColumns = cursor.current?.value === '(' ? cursor.columns() : [];
  const result: SqlConstraint = { columns, kind: 'foreign', referencedColumns, references };
  foreignOptions(cursor, result);
  return result;
};

const indexColumns = (cursor: Cursor): SqlIndex['columns'] =>
  splitTopLevel(cursor.group(), ',').map((tokens) => {
    const part = new Cursor(tokens, cursor.dialect, cursor.source);
    const name = part.identifier();
    let length: number | undefined;
    if (part.current?.value === '(') {
      length = Number(textOf(part.group(), part.source));
      if (!Number.isInteger(length) || length <= 0)
        throw new SqlParseError('Invalid index prefix length');
    }
    const order = part.take('ASC') ? 'ASC' : part.take('DESC') ? 'DESC' : undefined;
    if (!part.done)
      throw new SqlParseError('Expression indexes and operator classes are not supported');
    return { ...(length ? { length } : {}), name, ...(order ? { order } : {}) };
  });

export const parseSqlSchema = (sql: string, dialect: SqlDialect): SqlResult => {
  if (sql.length > 2_000_000)
    throw new SqlParseError('SQL import is limited to 2 MB. Export only the schemas you need.');
  const schema: SqlSchema = { dialect, enums: [], sequences: [], tables: [], version: 1 };
  const warnings = new Set<string>();
  const warn = (message: string): void => {
    warnings.add(message);
  };
  if (/\/\*![\d\s]*(?:CREATE|ALTER)\b/i.test(sql))
    warn(
      'DDL inside MySQL version-conditional comments is not imported. Export plain CREATE TABLE DDL for those objects.'
    );
  const tables = new Map<string, SqlTable>();
  const deferred: (() => void)[] = [];
  let currentSchema: string | undefined;
  const findTable = (name: SqlName): SqlTable => {
    const exact = tables.get(nameKey(name));
    if (exact) return exact;
    const matches = schema.tables.filter(
      (table) =>
        table.name === name.name && (!name.schema || (!table.schema && name.schema === 'public'))
    );
    if (matches.length === 1) return matches[0];
    throw new SqlParseError(`Table ${displayName(name)} is not defined in this SQL file`);
  };
  const namedConstraint = (cursor: Cursor, table: SqlTable, defaultSchema?: string): boolean => {
    const start = cursor.position;
    const name = cursor.take('CONSTRAINT') ? cursor.identifier() : undefined;
    let constraint: SqlConstraint;
    if (cursor.take('PRIMARY')) {
      cursor.require('KEY');
      constraint = { columns: cursor.columns(), kind: 'primary', name };
    } else if (cursor.take('UNIQUE')) {
      if (!cursor.take('KEY')) cursor.take('INDEX');
      const indexName = cursor.current?.value === '(' ? undefined : cursor.identifier();
      constraint = { columns: cursor.columns(), kind: 'unique', name: name ?? indexName };
    } else if (cursor.take('FOREIGN')) {
      cursor.require('KEY');
      // MySQL optionally names the supporting index before the column list.
      if (cursor.current?.value !== '(') cursor.identifier();
      const columns = cursor.columns();
      cursor.require('REFERENCES');
      constraint = { ...reference(cursor, columns, defaultSchema), name };
    } else if (cursor.take('CHECK')) {
      constraint = { columns: [], expression: textOf(cursor.group(), sql), kind: 'check', name };
    } else if (cursor.take('KEY') || cursor.take('INDEX')) {
      const indexName =
        cursor.current?.value === '('
          ? `idx_${table.name}_${table.indexes.length + 1}`
          : cursor.identifier();
      const method = cursor.take('USING') ? cursor.identifier() : undefined;
      table.indexes.push({ columns: indexColumns(cursor), method, name: indexName, unique: false });
      if (!cursor.done) warn(`${displayName(table)}: additional index options were omitted.`);
      return true;
    } else {
      cursor.position = start;
      return false;
    }
    foreignOptions(cursor, constraint);
    table.constraints.push(constraint);
    if (!cursor.done)
      warn(
        `${displayName(table)}: unsupported options on ${constraint.name ?? constraint.kind} constraint were omitted.`
      );
    return true;
  };
  const columnAttributes = (
    cursor: Cursor,
    column: SqlColumn,
    table: SqlTable,
    defaultSchema?: string
  ): void => {
    let constraintName: string | undefined;
    while (!cursor.done) {
      if (cursor.take('CONSTRAINT')) constraintName = cursor.identifier();
      else if (cursor.take('NOT')) {
        cursor.require('NULL');
        column.nullable = false;
      } else if (cursor.take('NULL')) column.nullable = true;
      else if (cursor.take('DEFAULT')) column.defaultSql = expressionUntilAttribute(cursor);
      else if (cursor.take('AUTO_INCREMENT')) {
        column.autoIncrement = true;
        column.nullable = false;
      } else if (cursor.take('PRIMARY')) {
        cursor.require('KEY');
        column.nullable = false;
        table.constraints.push({ columns: [column.name], kind: 'primary', name: constraintName });
        constraintName = undefined;
      } else if (cursor.take('UNIQUE')) {
        cursor.take('KEY');
        table.constraints.push({ columns: [column.name], kind: 'unique', name: constraintName });
        constraintName = undefined;
      } else if (cursor.take('REFERENCES')) {
        table.constraints.push({
          ...reference(cursor, [column.name], defaultSchema),
          name: constraintName
        });
        constraintName = undefined;
      } else if (cursor.take('CHECK')) {
        table.constraints.push({
          columns: [column.name],
          expression: textOf(cursor.group(), sql),
          kind: 'check',
          name: constraintName
        });
        constraintName = undefined;
      } else if (cursor.take('COMMENT')) column.comment = cursor.string();
      else if (cursor.take('COLLATE')) column.collation = cursor.identifier();
      else if (cursor.take('CHARACTER')) {
        cursor.require('SET');
        column.charset = cursor.identifier();
      } else if (cursor.take('CHARSET')) column.charset = cursor.identifier();
      else if (cursor.take('ON')) {
        cursor.require('UPDATE');
        column.onUpdate = expressionUntilAttribute(cursor);
      } else if (cursor.take('GENERATED')) {
        const always = cursor.take('ALWAYS');
        if (!always) {
          cursor.require('BY');
          cursor.require('DEFAULT');
        }
        cursor.require('AS');
        if (cursor.take('IDENTITY')) {
          column.identity = {
            always,
            ...(cursor.current?.value === '(' ? { options: textOf(cursor.group(), sql) } : {})
          };
          column.nullable = false;
        } else {
          const expression = textOf(cursor.group(), sql);
          const storage = cursor.take('STORED') ? 'STORED' : (cursor.take('VIRTUAL'), 'VIRTUAL');
          column.generated = { expression, storage };
        }
      } else if (cursor.take('AS') && dialect === 'mysql') {
        const expression = textOf(cursor.group(), sql);
        const storage =
          cursor.take('STORED') || cursor.take('PERSISTENT')
            ? 'STORED'
            : (cursor.take('VIRTUAL'), 'VIRTUAL');
        column.generated = { expression, storage };
      } else {
        warn(
          `${displayName(table)}.${column.name}: unsupported column options starting at ${cursor.current?.value ?? ''} were omitted.`
        );
        break;
      }
    }
  };
  const addDefinition = (tokens: Token[], table: SqlTable, defaultSchema?: string): void => {
    const cursor = new Cursor(tokens, dialect, sql);
    if (namedConstraint(cursor, table, defaultSchema)) return;
    if (['EXCLUDE', 'LIKE', 'FULLTEXT', 'SPATIAL'].some((word) => cursor.is(word)))
      throw new SqlParseError(`Unsupported table definition: ${cursor.current?.value}`);
    const name = cursor.identifier();
    const start = cursor.position;
    let depth = 0;
    while (!cursor.done) {
      const token = cursor.current;
      if (!depth && atAttribute(tokens, cursor.position)) break;
      if (token?.kind === 'symbol' && ['(', '['].includes(token.value)) depth++;
      if (token?.kind === 'symbol' && [')', ']'].includes(token.value)) depth--;
      cursor.position++;
    }
    const type = textOf(tokens.slice(start, cursor.position), sql);
    if (!type) throw new SqlParseError(`Missing type for column ${name}`);
    if (table.columns.some((column) => column.name === name))
      throw new SqlParseError(`Duplicate column ${displayName(table)}.${name}`);
    const serial = /^(?:smallserial|serial|bigserial|serial[248])$/i.test(type);
    const column: SqlColumn = {
      ...(serial ? { autoIncrement: true } : {}),
      name,
      nullable: !serial,
      type
    };
    columnAttributes(cursor, column, table, defaultSchema);
    table.columns.push(column);
  };
  const statements = splitTopLevel(tokenize(sql, dialect), ';');
  for (const tokens of statements) {
    const cursor = new Cursor(tokens, dialect, sql);
    const context = currentSchema;
    try {
      if (cursor.take('USE')) {
        currentSchema = cursor.identifier();
        continue;
      }
      if (cursor.take('SET')) {
        if (cursor.take('SEARCH_PATH')) {
          if (!cursor.symbol('=')) cursor.take('TO');
          if (cursor.current?.kind === 'identifier' || cursor.current?.kind === 'word')
            currentSchema = cursor.identifier();
        }
        continue;
      }
      if (cursor.take('CREATE')) {
        const unique = cursor.take('UNIQUE');
        if (cursor.take('TABLE')) {
          if (cursor.take('IF')) {
            cursor.require('NOT');
            cursor.require('EXISTS');
          }
          const name = cursor.name(context);
          if (tables.has(nameKey(name)))
            throw new SqlParseError(`Duplicate CREATE TABLE for ${displayName(name)}`);
          const table: SqlTable = { ...name, columns: [], constraints: [], indexes: [] };
          const definitions = splitTopLevel(cursor.group(), ',');
          for (const definition of definitions) {
            try {
              addDefinition(definition, table, table.schema);
            } catch (caught) {
              if (
                definition[0]?.kind === 'word' &&
                [
                  'CONSTRAINT',
                  'CHECK',
                  'UNIQUE',
                  'KEY',
                  'INDEX',
                  'EXCLUDE',
                  'FULLTEXT',
                  'SPATIAL',
                  'LIKE'
                ].includes(definition[0].value.toUpperCase())
              )
                warn(
                  `${displayName(name)}: ${caught instanceof Error ? caught.message : 'Unsupported constraint'}.`
                );
              else throw caught;
            }
          }
          while (!cursor.done) {
            if (cursor.take('ENGINE')) {
              cursor.symbol('=');
              table.engine = cursor.identifier();
            } else if (cursor.take('COMMENT')) {
              cursor.symbol('=');
              table.comment = cursor.string();
            } else if (cursor.take('DEFAULT')) {
              /* optional prefix for character set */
            } else if (
              cursor.take('CHARSET') ||
              (cursor.take('CHARACTER') && (cursor.require('SET'), true))
            ) {
              cursor.symbol('=');
              table.charset = cursor.identifier();
            } else if (cursor.take('COLLATE')) {
              cursor.symbol('=');
              table.collation = cursor.identifier();
            } else {
              warn(
                `${displayName(table)}: table/storage options starting at ${cursor.current?.value} were omitted.`
              );
              break;
            }
          }
          tables.set(nameKey(name), table);
          schema.tables.push(table);
        } else if (cursor.take('TYPE')) {
          const name = cursor.name(context);
          cursor.require('AS');
          cursor.require('ENUM');
          const values = splitTopLevel(cursor.group(), ',').map((part) =>
            new Cursor(part, dialect, sql).string()
          );
          schema.enums.push({ ...name, values });
        } else if (cursor.take('SEQUENCE')) {
          if (cursor.take('IF')) {
            cursor.require('NOT');
            cursor.require('EXISTS');
          }
          const name = cursor.name(context);
          schema.sequences.push({ ...name, definition: cursor.rest() });
        } else if (cursor.take('INDEX')) {
          cursor.take('CONCURRENTLY');
          if (cursor.take('IF')) {
            cursor.require('NOT');
            cursor.require('EXISTS');
          }
          const name = cursor.name(context);
          cursor.require('ON');
          cursor.take('ONLY');
          const tableName = cursor.name(context);
          const method = cursor.take('USING') ? cursor.identifier() : undefined;
          const columns = indexColumns(cursor);
          const include = cursor.take('INCLUDE') ? cursor.columns() : undefined;
          const where = cursor.take('WHERE') ? cursor.rest() : undefined;
          if (!where && !cursor.done) warn(`${name.name}: unsupported index options were omitted.`);
          deferred.push(() => {
            findTable(tableName).indexes.push({
              columns,
              include,
              method,
              name: name.name,
              unique,
              where
            });
          });
        } else if (cursor.is('SCHEMA') || cursor.is('DATABASE')) {
          /* Names are captured on the tables that use them. */
        } else
          warn(
            `Skipped CREATE ${cursor.current?.value ?? ''}: only table schema objects are imported.`
          );
      } else if (cursor.take('ALTER')) {
        if (cursor.take('TABLE')) {
          cursor.take('ONLY');
          const name = cursor.name(context);
          const remaining = cursor.tokens.slice(cursor.position);
          deferred.push(() => {
            const table = findTable(name);
            for (const part of splitTopLevel(remaining, ',')) {
              const action = new Cursor(part, dialect, sql);
              if (action.take('ADD')) {
                action.take('COLUMN');
                addDefinition(part.slice(action.position), table, table.schema);
              } else if (action.take('ALTER')) {
                action.take('COLUMN');
                const name = action.identifier();
                const column = table.columns.find((col) => col.name === name);
                if (!column) throw new SqlParseError(`Unknown column ${name}`);
                if (action.take('SET')) {
                  if (action.take('DEFAULT')) column.defaultSql = action.rest();
                  else if (action.take('NOT')) {
                    action.require('NULL');
                    column.nullable = false;
                  } else
                    throw new SqlParseError(
                      `Unsupported ALTER COLUMN SET ${action.current?.value}`
                    );
                } else if (action.take('ADD')) columnAttributes(action, column, table, context);
                else throw new SqlParseError(`Unsupported ALTER COLUMN ${action.current?.value}`);
              } else if (!action.is('OWNER'))
                warn(`${displayName(name)}: ALTER ${action.current?.value} was omitted.`);
            }
          });
        } else if (cursor.take('SEQUENCE')) {
          const name = cursor.name(context);
          if (cursor.take('OWNED')) {
            cursor.require('BY');
            if (!cursor.take('NONE')) {
              const parts = [cursor.identifier()];
              while (cursor.symbol('.')) parts.push(cursor.identifier());
              if (parts.length < 2 || parts.length > 3)
                throw new SqlParseError(
                  'Expected table.column or schema.table.column for sequence ownership'
                );
              const owner: SqlName = {
                name: parts[parts.length - 2],
                schema: parts.length === 3 ? parts[0] : context
              };
              const column = parts[parts.length - 1];
              deferred.push(() => {
                const seq = schema.sequences.find((item) => nameKey(item) === nameKey(name));
                if (seq) seq.ownedBy = { column, table: owner };
              });
            }
          }
        } else warn(`Skipped ALTER ${cursor.current?.value ?? ''}.`);
      } else if (cursor.take('COMMENT')) {
        cursor.require('ON');
        const onTable = cursor.take('TABLE');
        if (!onTable) cursor.require('COLUMN');
        const name = cursor.name(context);
        let column: string | undefined;
        if (!onTable) {
          if (cursor.symbol('.')) column = cursor.identifier();
          else {
            column = name.name;
            name.name = name.schema ?? '';
            name.schema = context;
          }
        }
        cursor.require('IS');
        const comment = cursor.take('NULL') ? undefined : cursor.string();
        deferred.push(() => {
          const table = findTable(name);
          if (onTable) table.comment = comment;
          else {
            const target = table.columns.find((item) => item.name === column);
            if (target) target.comment = comment;
            else throw new SqlParseError(`Comment references unknown column ${column}`);
          }
        });
      } else if (
        ['GRANT', 'REVOKE', 'RESET', 'BEGIN', 'COMMIT', 'START', 'LOCK', 'UNLOCK'].some((word) =>
          cursor.is(word)
        )
      ) {
        /* Session/access settings are outside a schema diagram. */
      } else if (
        cursor.is('SELECT') &&
        tokens.some((token) => token.value.toLowerCase() === 'set_config')
      ) {
        /* pg_dump session setup */
      } else
        warn(
          `Skipped ${cursor.current?.value?.toUpperCase() ?? 'statement'}: data and non-table objects are not imported.`
        );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Invalid SQL';
      if (keyword(tokens[0], 'CREATE') && keyword(tokens[1], 'TABLE'))
        throw new SqlParseError(message, tokens[0].start);
      warn(`${message} (statement at line ${sql.slice(0, tokens[0].start).split('\n').length}).`);
    }
  }
  for (const operation of deferred) {
    try {
      operation();
    } catch (caught) {
      warn(caught instanceof Error ? caught.message : 'Unsupported schema change');
    }
  }
  if (!schema.tables.length)
    throw new SqlParseError(
      'No CREATE TABLE definitions found. Import a schema/DDL file, not query results.'
    );
  for (const table of schema.tables) {
    for (const constraint of table.constraints) {
      if (constraint.kind === 'primary')
        for (const name of constraint.columns) {
          const column = table.columns.find((col) => col.name === name);
          if (column) column.nullable = false;
        }
      if (constraint.kind === 'foreign' && constraint.references) {
        try {
          const referenced = findTable(constraint.references);
          constraint.references = { name: referenced.name, schema: referenced.schema };
          if (!constraint.referencedColumns?.length)
            constraint.referencedColumns =
              referenced.constraints.find((item) => item.kind === 'primary')?.columns ?? [];
        } catch {
          warn(
            `${displayName(table)} references external table ${displayName(constraint.references)}.`
          );
        }
      }
    }
  }
  return { schema, warnings: [...warnings] };
};
