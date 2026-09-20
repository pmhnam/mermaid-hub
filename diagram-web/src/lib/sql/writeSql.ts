import { Cursor, splitTopLevel, tokenize } from './lexer';
import {
  displayName,
  nameKey,
  type SqlColumn,
  type SqlConstraint,
  type SqlDialect,
  type SqlName,
  type SqlSchema,
  type SqlTable
} from './types';

export interface SqlExport {
  sql: string;
  warnings: string[];
}
export const quoteIdentifier = (name: string, dialect: SqlDialect): string => {
  if (!name || /[\0\r\n]/.test(name))
    throw new Error('SQL identifiers must not be empty or contain control characters.');
  const quote = dialect === 'postgresql' ? '"' : '`';
  return quote + name.replaceAll(quote, quote + quote) + quote;
};
const literal = (value: string, dialect: SqlDialect): string => {
  const escaped = value.replaceAll("'", "''");
  return dialect === 'postgresql'
    ? `E'${escaped.replaceAll('\\', '\\\\')}'`
    : `'${escaped.replaceAll('\\', '\\\\')}'`;
};

/** Schema fragments are parsed, never executed. Reject statement separators in
 * types/defaults so malformed edited ER fields cannot generate extra statements. */
const fragment = (value: string, dialect: SqlDialect): string => {
  const tokens = tokenize(value, dialect);
  if (!tokens.length || tokens.some((token) => token.kind === 'symbol' && token.value === ';'))
    throw new Error(`Invalid SQL fragment: ${value.slice(0, 80)}`);
  splitTopLevel(tokens, ';');
  return value.trim();
};

export const writeSqlSchema = (schema: SqlSchema, dialect: SqlDialect): SqlExport => {
  const warnings = new Set<string>();
  const cross = schema.dialect !== dialect;
  const q = (name: string) => quoteIdentifier(name, dialect);
  const option = (value: string): string => {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) throw new Error(`Invalid SQL option: ${value}`);
    return value;
  };
  const tableName = (name: SqlName) =>
    name.schema ? `${q(name.schema)}.${q(name.name)}` : q(name.name);
  const list = (columns: string[]) => columns.map(q).join(', ');
  const warn = (text: string) => {
    warnings.add(text);
  };
  if (cross)
    warn(
      `Converted ${schema.dialect === 'mysql' ? 'MySQL/MariaDB' : 'PostgreSQL'} DDL to ${dialect === 'mysql' ? 'MySQL/MariaDB' : 'PostgreSQL'}. Review type and expression conversions before applying it.`
    );
  const enumFor = (type: string, table: SqlTable) => {
    try {
      const c = new Cursor(tokenize(type, schema.dialect), schema.dialect, type);
      const n = c.name(table.schema);
      return c.done ? schema.enums.find((e) => nameKey(e) === nameKey(n)) : undefined;
    } catch {
      return undefined;
    }
  };
  const convertedType = (column: SqlColumn, table: SqlTable): string => {
    const type = fragment(column.type, schema.dialect);
    if (!cross) return type;
    const compact = type.toLowerCase().replaceAll(/\s+/g, ' ').trim();
    const enumeration = enumFor(type, table);
    if (enumeration && dialect === 'mysql')
      return `ENUM(${enumeration.values.map((v) => literal(v, dialect)).join(', ')})`;
    if (dialect === 'mysql') {
      if (/^(smallserial|serial2)$/.test(compact)) return 'SMALLINT';
      if (/^(serial|serial4)$/.test(compact)) return 'INT';
      if (/^(bigserial|serial8)$/.test(compact)) return 'BIGINT';
      if (compact === 'uuid') {
        warn('PostgreSQL UUID is exported as CHAR(36).');
        return 'CHAR(36)';
      }
      if (compact === 'bytea') return 'LONGBLOB';
      if (compact === 'jsonb') {
        warn('JSONB is exported as JSON.');
        return 'JSON';
      }
      if (/^(?:timestamp(?:\(\d+\))? with time zone|timestamptz(?:\(\d+\))?)$/.test(compact)) {
        warn(
          'Timezone-aware timestamps are exported as TIMESTAMP; MySQL timezone semantics differ.'
        );
        return 'TIMESTAMP' + (compact.match(/\(\d+\)/)?.[0] ?? '');
      }
      if (/^timestamp/.test(compact)) return 'DATETIME' + (compact.match(/\(\d+\)/)?.[0] ?? '');
      if (/\[\]$/.test(compact)) {
        warn(`${displayName(table)}.${column.name}: array type ${type} is exported as JSON.`);
        return 'JSON';
      }
      if (compact.startsWith('character varying'))
        return type.replace(/character\s+varying/i, 'VARCHAR');
      if (compact === 'double precision') return 'DOUBLE';
      if (['int2', 'int4', 'int8', 'float4', 'float8', 'bool'].includes(compact))
        return (
          {
            bool: 'BOOLEAN',
            float4: 'FLOAT',
            float8: 'DOUBLE',
            int2: 'SMALLINT',
            int4: 'INT',
            int8: 'BIGINT'
          } as Record<string, string>
        )[compact];
    } else {
      if (/\bunsigned\b/.test(compact))
        warn(
          `${displayName(table)}.${column.name}: UNSIGNED is omitted; PostgreSQL integers are signed.`
        );
      if (/^tinyint\(1\)(?: unsigned)?$/.test(compact)) return 'BOOLEAN';
      if (
        /^(?:tinyint|smallint|mediumint|int|integer|bigint)(?:\(\d+\))?(?: unsigned)?$/.test(
          compact
        )
      )
        return /^bigint/.test(compact)
          ? 'BIGINT'
          : /^(tinyint|smallint)/.test(compact)
            ? 'SMALLINT'
            : 'INTEGER';
      if (/^(?:longblob|mediumblob|tinyblob|blob|binary|varbinary)/.test(compact)) return 'BYTEA';
      if (/^(?:longtext|mediumtext|tinytext)$/.test(compact)) return 'TEXT';
      if (/^(?:datetime|timestamp)/.test(compact))
        return `TIMESTAMP${compact.match(/\(\d+\)/)?.[0] ?? ''}`;
      if (compact === 'double') return 'DOUBLE PRECISION';
      if (compact === 'float') return 'REAL';
      if (/^(enum|set)\(/.test(compact)) {
        warn(
          `${displayName(table)}.${column.name}: ${compact.startsWith('enum') ? 'ENUM' : 'SET'} is exported as TEXT; allowed-value enforcement is omitted.`
        );
        return 'TEXT';
      }
    }
    if (
      /^(?:int|integer|smallint|bigint|numeric|decimal|varchar|char|character|text|boolean|bool|date|time|json|real|float|double precision)(?:\([\d,\s]+\))?$/.test(
        compact
      )
    )
      return type;
    warn(
      `${displayName(table)}.${column.name}: unsupported cross-database type ${type}; exported as TEXT.`
    );
    return 'TEXT';
  };
  const convertedDefault = (
    column: SqlColumn,
    type: string,
    table: SqlTable
  ): string | undefined => {
    if (!column.defaultSql) return;
    const value = fragment(column.defaultSql, schema.dialect);
    if (!cross) return value;
    let converted = value;
    if (/^nextval\(/i.test(value)) {
      warn(`${displayName(table)}.${column.name}: sequence default converted to AUTO_INCREMENT.`);
      return;
    }
    // Strip simple PostgreSQL literal casts, preserving the literal itself.
    converted = converted.replace(
      /::(?:pg_catalog\.)?(?:character varying|text|varchar|uuid|jsonb?|numeric|integer|bigint|boolean)(?:\([\d, ]+\))?$/i,
      ''
    );
    if (
      /^(null|true|false|current_timestamp(?:\(\d*\))?|current_date|current_time|[-+]?\d+(?:\.\d+)?)$/i.test(
        converted
      )
    ) {
      if (type === 'BOOLEAN' && ['0', '1'].includes(converted))
        return converted === '1' ? 'TRUE' : 'FALSE';
      return converted;
    }
    if (/^(?:now|current_timestamp)\(\)$/i.test(converted)) return 'CURRENT_TIMESTAMP';
    const tokens = tokenize(converted, schema.dialect);
    if (tokens.length === 1 && tokens[0].kind === 'string')
      return literal(tokens[0].value, dialect);
    if (tokens.length === 2 && tokens[0].value.toUpperCase() === 'E' && tokens[1].kind === 'string')
      return literal(tokens[1].value, dialect);
    warn(`${displayName(table)}.${column.name}: database-specific default ${value} was omitted.`);
    return;
  };
  const constraintSql = (constraint: SqlConstraint, table: SqlTable): string | undefined => {
    if (constraint.kind !== 'check' && !constraint.columns.length) {
      warn(`${displayName(table)}: empty ${constraint.kind} constraint omitted.`);
      return;
    }
    if (constraint.columns.some((column) => !table.columns.some((item) => item.name === column))) {
      warn(
        `${displayName(table)}: ${constraint.name ?? constraint.kind} references a removed column and was omitted.`
      );
      return;
    }
    const prefix = constraint.name ? `CONSTRAINT ${q(constraint.name)} ` : '';
    if (constraint.kind === 'primary') return `${prefix}PRIMARY KEY (${list(constraint.columns)})`;
    if (constraint.kind === 'unique') return `${prefix}UNIQUE (${list(constraint.columns)})`;
    if (constraint.kind === 'check') {
      if (cross) {
        warn(
          `${displayName(table)}: CHECK ${constraint.name ?? ''} was omitted during dialect conversion.`
        );
        return;
      }
      return `${prefix}CHECK (${fragment(constraint.expression ?? '', dialect)})`;
    }
    if (
      !constraint.references ||
      !constraint.referencedColumns?.length ||
      constraint.columns.length !== constraint.referencedColumns.length
    ) {
      warn(
        `${displayName(table)}: foreign key ${constraint.name ?? ''} has no complete column mapping and was omitted.`
      );
      return;
    }
    const target = schema.tables.find(
      (item) => nameKey(item) === nameKey(constraint.references as SqlName)
    );
    if (
      target &&
      constraint.referencedColumns.some(
        (name) => !target.columns.some((column) => column.name === name)
      )
    ) {
      warn(
        `${displayName(table)}: foreign key references a removed target column and was omitted.`
      );
      return;
    }
    let result = `${prefix}FOREIGN KEY (${list(constraint.columns)}) REFERENCES ${tableName(constraint.references)} (${list(constraint.referencedColumns)})`;
    if (constraint.match && dialect === 'postgresql') result += ` MATCH ${constraint.match}`;
    for (const operation of ['onDelete', 'onUpdate'] as const)
      if (constraint[operation]) {
        if (dialect === 'mysql' && constraint[operation] === 'SET DEFAULT') {
          warn(
            `${displayName(table)}: MySQL does not support SET DEFAULT referential actions; omitted.`
          );
          continue;
        }
        result += ` ON ${operation === 'onDelete' ? 'DELETE' : 'UPDATE'} ${constraint[operation]}`;
      }
    if (constraint.deferrable && dialect === 'postgresql')
      result += ` DEFERRABLE INITIALLY ${constraint.initiallyDeferred ? 'DEFERRED' : 'IMMEDIATE'}`;
    if (constraint.deferrable && dialect === 'mysql')
      warn(`${displayName(table)}: deferred constraint checks are not supported by MySQL.`);
    return result;
  };
  const lines = [
    `-- Generated schema DDL for ${dialect === 'mysql' ? 'MySQL / MariaDB' : 'PostgreSQL'}. No data included.`,
    ''
  ];
  const namespaces = [
    ...new Set(
      [...schema.tables, ...(!cross ? [...schema.enums, ...schema.sequences] : [])].flatMap(
        (table) => (table.schema ? [table.schema] : [])
      )
    )
  ];
  for (const namespace of namespaces)
    lines.push(
      `CREATE ${dialect === 'mysql' ? 'DATABASE' : 'SCHEMA'} IF NOT EXISTS ${q(namespace)};`
    );
  if (!cross && dialect === 'postgresql') {
    for (const enumeration of schema.enums)
      lines.push(
        `CREATE TYPE ${tableName(enumeration)} AS ENUM (${enumeration.values.map((value) => literal(value, dialect)).join(', ')});`
      );
    for (const sequence of schema.sequences)
      lines.push(
        `CREATE SEQUENCE ${tableName(sequence)}${sequence.definition ? ` ${fragment(sequence.definition, dialect)}` : ''};`
      );
  }
  if (cross && schema.sequences.length && dialect === 'postgresql')
    warn('Standalone sequences from the source dialect were omitted.');
  const inlineIndexes = new Set<string>();
  for (const table of schema.tables) {
    if (!table.columns.length) {
      warn(`${displayName(table)} has no columns and was omitted.`);
      continue;
    }
    const autoColumns: string[] = [];
    const definitions = table.columns.map((column) => {
      const type = convertedType(column, table);
      const primary = table.constraints.some(
        (constraint) => constraint.kind === 'primary' && constraint.columns.includes(column.name)
      );
      const auto =
        column.autoIncrement ||
        Boolean(column.identity) ||
        (cross && /^nextval\(/i.test(column.defaultSql ?? ''));
      if (auto && dialect === 'mysql') autoColumns.push(column.name);
      let definition = `${q(column.name)} ${type}`;
      if (column.generated) {
        if (cross)
          warn(
            `${displayName(table)}.${column.name}: generated expression was omitted during dialect conversion.`
          );
        else
          definition += ` GENERATED ALWAYS AS (${fragment(column.generated.expression, dialect)}) ${column.generated.storage}`;
      }
      if (dialect === 'postgresql' && column.identity)
        definition += ` GENERATED ${column.identity.always ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY${column.identity.options && !cross ? ` (${fragment(column.identity.options, dialect)})` : ''}`;
      else if (cross && dialect === 'postgresql' && auto)
        definition += ' GENERATED BY DEFAULT AS IDENTITY';
      definition += !column.nullable || primary ? ' NOT NULL' : '';
      const defaultSql =
        column.generated || column.identity || (cross && auto)
          ? undefined
          : convertedDefault(column, type, table);
      if (defaultSql !== undefined) definition += ` DEFAULT ${defaultSql}`;
      if (dialect === 'mysql' && auto) definition += ' AUTO_INCREMENT';
      if (column.collation && !cross)
        definition += ` COLLATE ${dialect === 'mysql' ? option(column.collation) : q(column.collation)}`;
      if (column.charset && dialect === 'mysql' && !cross)
        definition += ` CHARACTER SET ${option(column.charset)}`;
      if (column.onUpdate && dialect === 'mysql' && !cross)
        definition += ` ON UPDATE ${fragment(column.onUpdate, dialect)}`;
      else if (column.onUpdate)
        warn(`${displayName(table)}.${column.name}: ON UPDATE expression omitted for PostgreSQL.`);
      if (column.comment && dialect === 'mysql')
        definition += ` COMMENT ${literal(column.comment, dialect)}`;
      return definition;
    });
    definitions.push(
      ...table.constraints
        .filter((constraint) => constraint.kind !== 'foreign')
        .flatMap((constraint) => constraintSql(constraint, table) ?? [])
    );
    for (const name of autoColumns) {
      if (
        table.constraints.some(
          (constraint) =>
            ['primary', 'unique'].includes(constraint.kind) && constraint.columns[0] === name
        )
      )
        continue;
      const index = table.indexes.find(
        (index) => index.columns[0]?.name === name && !index.where && !index.include?.length
      );
      if (index) {
        definitions.push(
          `${index.unique ? 'UNIQUE ' : ''}KEY ${q(index.name)} (${index.columns.map((part) => `${q(part.name)}${part.length ? `(${part.length})` : ''}${part.order ? ` ${part.order}` : ''}`).join(', ')})`
        );
        inlineIndexes.add(JSON.stringify([nameKey(table), index.name]));
      } else {
        definitions.push(`KEY ${q(`sql_auto_${autoColumns.indexOf(name) + 1}`)} (${q(name)})`);
        warn(
          `${displayName(table)}.${name}: added a supporting index required for MySQL AUTO_INCREMENT.`
        );
      }
    }
    if (autoColumns.length > 1)
      throw new Error(
        `${displayName(table)} has more than one auto-generated column; MySQL allows only one AUTO_INCREMENT column.`
      );
    let suffix = '';
    if (dialect === 'mysql') {
      suffix = ` ENGINE=${!cross && table.engine ? option(table.engine) : 'InnoDB'}`;
      if (!cross && table.charset) suffix += ` DEFAULT CHARSET=${option(table.charset)}`;
      if (!cross && table.collation) suffix += ` COLLATE=${option(table.collation)}`;
      if (table.comment) suffix += ` COMMENT=${literal(table.comment, dialect)}`;
    }
    lines.push(
      '',
      `CREATE TABLE ${tableName(table)} (\n${definitions.map((line) => `  ${line}`).join(',\n')}\n)${suffix};`
    );
  }
  // Indexes (including referenced unique indexes) must exist before adding FKs.
  for (const table of schema.tables.filter((item) => item.columns.length)) {
    for (const index of table.indexes) {
      if (inlineIndexes.has(JSON.stringify([nameKey(table), index.name]))) continue;
      if (
        !index.columns.length ||
        index.columns.some((part) => !table.columns.some((column) => column.name === part.name))
      ) {
        warn(`${displayName(table)}: index ${index.name} references missing columns; omitted.`);
        continue;
      }
      if (
        cross &&
        (index.where ||
          index.include?.length ||
          (index.method && !['btree', 'hash'].includes(index.method.toLowerCase())))
      ) {
        warn(`${displayName(table)}: dialect-specific index ${index.name} omitted.`);
        continue;
      }
      const cols = index.columns
        .map(
          (part) =>
            `${q(part.name)}${part.length && dialect === 'mysql' ? `(${part.length})` : ''}${part.order ? ` ${part.order}` : ''}`
        )
        .join(', ');
      if (cross && index.columns.some((part) => part.length))
        warn(`${displayName(table)}.${index.name}: index prefix lengths omitted for PostgreSQL.`);
      const method = index.method && !cross ? ` USING ${option(index.method)}` : '';
      lines.push(
        `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${q(index.name)} ON ${tableName(table)}${method} (${cols})${!cross && index.include?.length ? ` INCLUDE (${list(index.include)})` : ''}${!cross && index.where ? ` WHERE ${fragment(index.where, dialect)}` : ''};`
      );
    }
    if (dialect === 'postgresql') {
      if (table.comment)
        lines.push(`COMMENT ON TABLE ${tableName(table)} IS ${literal(table.comment, dialect)};`);
      for (const column of table.columns)
        if (column.comment)
          lines.push(
            `COMMENT ON COLUMN ${tableName(table)}.${q(column.name)} IS ${literal(column.comment, dialect)};`
          );
    }
  }
  for (const table of schema.tables.filter((item) => item.columns.length)) {
    for (const constraint of table.constraints.filter((item) => item.kind === 'foreign')) {
      const ddl = constraintSql(constraint, table);
      if (ddl) lines.push(`ALTER TABLE ${tableName(table)} ADD ${ddl};`);
    }
  }
  if (!cross && dialect === 'postgresql')
    for (const sequence of schema.sequences)
      if (sequence.ownedBy)
        lines.push(
          `ALTER SEQUENCE ${tableName(sequence)} OWNED BY ${tableName(sequence.ownedBy.table)}.${q(sequence.ownedBy.column)};`
        );
  return { sql: `${lines.join('\n')}\n`, warnings: [...warnings] };
};
