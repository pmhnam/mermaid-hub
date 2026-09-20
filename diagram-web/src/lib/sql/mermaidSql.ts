import { encode, decode } from 'js-base64';
import { parseSqlSchema } from './parseSql';
import { writeSqlSchema, type SqlExport } from './writeSql';
import {
  displayName,
  nameKey,
  type SqlColumn,
  type SqlDialect,
  type SqlName,
  type SqlSchema,
  type SqlTable
} from './types';

const metadataPrefix = '%% sql-schema-v1: ';
const safeComment = (value: string): string =>
  value
    .replaceAll(/["\r\n]/g, ' ')
    .replaceAll('\\', '/')
    .trim();
const fieldToken = (name: string, index: number): string =>
  /^[a-zA-Z_][\w-]*$/.test(name) ? name : `column_${index + 1}`;
const typeToken = (type: string): string => {
  const normalized = type.replaceAll(/\s+/g, '_').replaceAll(',', '_');
  return /^[a-zA-Z][\w()[\]-]*$/.test(normalized) ? normalized : 'custom_type';
};
const tableId = (table: SqlName): string => displayName(table).replaceAll(/["\r\n\\]/g, '_');

interface DiagramColumn {
  name: string;
  type: string;
  keys: string[];
  comment?: string;
}
interface DiagramTable {
  id: string;
  columns: DiagramColumn[];
}
interface DiagramRelation {
  from: string;
  to: string;
  label: string;
}
interface Diagram {
  tables: DiagramTable[];
  relations: DiagramRelation[];
  warnings: string[];
}

const parseEr = (source: string): Diagram => {
  const code = source.replace(/^\uFEFF?\s*---\s*\r?\n[\s\S]*?\r?\n\s*---\s*\r?\n/, '');
  if (!/^\s*erDiagram\b/m.test(code))
    throw new Error('SQL export requires an ER diagram (erDiagram).');
  const tables = new Map<string, DiagramTable>();
  const relations: DiagramRelation[] = [];
  const warnings: string[] = [];
  const get = (id: string): DiagramTable => {
    let table = tables.get(id);
    if (!table) {
      table = { columns: [], id };
      tables.set(id, table);
    }
    return table;
  };
  let table: DiagramTable | undefined;
  for (const raw of code.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('%%') || line === 'erDiagram') continue;
    if (table) {
      if (line === '}') {
        table = undefined;
        continue;
      }
      const field = line.match(
        /^(\S+)\s+(\S+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?\s*$/
      );
      if (!field)
        throw new Error(
          `Cannot export field definition: ${line.slice(0, 120)}. Use one Mermaid field per line.`
        );
      if (table.columns.some((column) => column.name === field[2]))
        throw new Error(`Duplicate field ${table.id}.${field[2]}.`);
      table.columns.push({
        comment: field[4],
        keys: field[3]?.split(/\s*,\s*/) ?? [],
        name: field[2],
        type: field[1]
      });
      continue;
    }
    const opening = line.match(/^(?:"([^"]+)"|([\w.-]+))(?:\s*\[[^\]]*\])?\s*\{\s*$/);
    if (opening) {
      table = get(opening[1] ?? opening[2]);
      continue;
    }
    const relation = line.match(
      /^(?:"([^"]+)"|([\w.-]+))\s+([|o{}1u]+)\s*(?:--|\.\.)\s*([|o{}1u]+)\s+(?:"([^"]+)"|([\w.-]+))\s*:\s*(?:"([^"]*)"|(.*))$/
    );
    if (relation) {
      const from = relation[1] ?? relation[2],
        to = relation[5] ?? relation[6];
      get(from);
      get(to);
      relations.push({ from, label: (relation[7] ?? relation[8]).trim(), to });
      continue;
    }
    if (/^(direction|style|classDef|class|accTitle|accDescr)\b/.test(line)) continue;
    const standalone = line.match(/^(?:"([^"]+)"|([\w.-]+))(?:\s*\[[^\]]*\])?\s*$/);
    if (standalone) {
      get(standalone[1] ?? standalone[2]);
      continue;
    }
    warnings.push(`Unsupported ER line omitted from SQL: ${line.slice(0, 100)}`);
  }
  if (table) throw new Error(`Unclosed entity block: ${table.id}`);
  return { relations, tables: [...tables.values()], warnings };
};

/** Assign Mermaid-safe names without changing the physical SQL identifiers. */
const projection = (schema: SqlSchema): { code: string; schema: SqlSchema } => {
  const copy: SqlSchema = structuredClone(schema);
  const used = new Set<string>();
  for (const [index, table] of copy.tables.entries()) {
    let id = tableId(table);
    if (used.has(id)) id += `_table_${index + 1}`;
    used.add(id);
    table.mermaidId = id;
    const fields = new Set<string>();
    for (const [i, column] of table.columns.entries()) {
      let name = fieldToken(column.name, i);
      while (fields.has(name)) name += '_';
      fields.add(name);
      column.mermaidName = name;
      column.mermaidType = typeToken(column.type);
    }
  }
  const lines = ['erDiagram'];
  let ordinal = 0;
  for (const table of copy.tables) {
    lines.push(`    "${table.mermaidId}" {`);
    for (const column of table.columns) {
      const keys = ['primary', 'foreign', 'unique'].flatMap((kind) =>
        table.constraints.some(
          (constraint) => constraint.kind === kind && constraint.columns.includes(column.name)
        )
          ? [{ primary: 'PK', foreign: 'FK', unique: 'UK' }[kind]]
          : []
      );
      const comment = safeComment(
        [
          column.comment,
          !column.nullable ? 'NOT NULL' : '',
          column.defaultSql ? `DEFAULT ${column.defaultSql}` : '',
          column.autoIncrement || column.identity ? 'auto-generated' : '',
          column.name !== column.mermaidName ? `SQL name: ${column.name}` : ''
        ]
          .filter(Boolean)
          .join(' · ')
      );
      lines.push(
        `        ${column.mermaidType} ${column.mermaidName}${keys.length ? ` ${keys.join(', ')}` : ''}${comment ? ` "${comment}"` : ''}`
      );
    }
    lines.push('    }');
  }
  for (const table of copy.tables)
    for (const fk of table.constraints.filter(
      (constraint) => constraint.kind === 'foreign' && constraint.references
    )) {
      const parent = copy.tables.find(
        (item) => nameKey(item) === nameKey(fk.references as SqlName)
      );
      if (!parent) continue;
      const label = `fk_${++ordinal}${fk.name ? `_${safeComment(fk.name)}` : ''}`;
      fk.relationLabel = label;
      const nullable = fk.columns.some(
        (name) => table.columns.find((column) => column.name === name)?.nullable
      );
      const unique = table.constraints.some(
        (constraint) =>
          ['primary', 'unique'].includes(constraint.kind) &&
          constraint.columns.length === fk.columns.length &&
          constraint.columns.every((column) => fk.columns.includes(column))
      );
      lines.push(
        `    "${parent.mermaidId}" ${nullable ? '|o' : '||'}--${unique ? 'o|' : 'o{'} "${table.mermaidId}" : "${label}"`
      );
    }
  return { code: lines.join('\n'), schema: copy };
};

export const importSql = (
  sql: string,
  dialect: SqlDialect
): { code: string; tables: number; columns: number; relationships: number; warnings: string[] } => {
  const parsed = parseSqlSchema(sql, dialect);
  const canonical = writeSqlSchema(parsed.schema, dialect);
  // Metadata contains only supported DDL, never INSERT/COPY data from a dump.
  const normalized = parseSqlSchema(canonical.sql, dialect);
  const result = projection(normalized.schema);
  const metadata = encode(JSON.stringify({ dialect, sql: canonical.sql }));
  const code = `${result.code}\n\n${metadataPrefix}${metadata}\n`;
  if (code.length > 1_000_000)
    throw new Error('Generated diagram exceeds the 1 MB workspace limit. Import fewer tables.');
  return {
    code,
    columns: result.schema.tables.reduce((sum, table) => sum + table.columns.length, 0),
    relationships: result.schema.tables.reduce(
      (sum, table) =>
        sum + table.constraints.filter((constraint) => constraint.kind === 'foreign').length,
      0
    ),
    tables: result.schema.tables.length,
    warnings: [...new Set([...parsed.warnings, ...canonical.warnings, ...normalized.warnings])]
  };
};

const readMetadata = (code: string): SqlSchema | undefined => {
  const line = code.split(/\r?\n/).find((line) => line.startsWith(metadataPrefix));
  if (!line) return;
  try {
    const value: unknown = JSON.parse(decode(line.slice(metadataPrefix.length)));
    if (
      !value ||
      typeof value !== 'object' ||
      !('sql' in value) ||
      !('dialect' in value) ||
      typeof value.sql !== 'string' ||
      !['postgresql', 'mysql'].includes(String(value.dialect))
    )
      throw new Error('Invalid metadata');
    return projection(parseSqlSchema(value.sql, value.dialect as SqlDialect).schema).schema;
  } catch {
    throw new Error(
      'SQL round-trip metadata is invalid. Re-import the SQL, or remove the %% sql-schema-v1 line to export only the visible ER structure.'
    );
  }
};

export const importedSqlDialect = (code: string): SqlDialect | undefined =>
  readMetadata(code)?.dialect;

export const exportErSql = (code: string, dialect: SqlDialect): SqlExport => {
  if (code.length > 1_000_000) throw new Error('Diagram exceeds the SQL export size limit.');
  const diagram = parseEr(code);
  const original = readMetadata(code);
  const warnings = [...diagram.warnings];
  if (!original)
    warnings.push(
      'This ERD has no imported SQL metadata. Defaults, nullability, indexes and physical FK column mappings cannot be recovered from Mermaid alone. Non-PK columns are nullable.'
    );
  if (original)
    warnings.push(
      'Defaults, nullability and indexes are preserved from import metadata. Editing displayed types, PK/UK/FK tags and relationship lines updates the SQL; descriptive field comments do not change SQL constraints.'
    );
  const schema: SqlSchema = {
    dialect: original?.dialect ?? dialect,
    enums: original?.enums ?? [],
    sequences: original?.sequences ?? [],
    tables: [],
    version: 1
  };
  const lookup = new Map<string, SqlTable>();
  for (const entity of diagram.tables) {
    const known = original?.tables.find((table) => table.mermaidId === entity.id);
    if (original && !known)
      warnings.push(
        `${entity.id}: new or renamed entity has no matching import metadata; only its visible columns/keys are exported.`
      );
    const dot = entity.id.lastIndexOf('.');
    const name = known
      ? { name: known.name, schema: known.schema }
      : dot >= 0
        ? { name: entity.id.slice(dot + 1), schema: entity.id.slice(0, dot) }
        : { name: entity.id };
    const table: SqlTable = {
      ...(known ?? {}),
      ...name,
      columns: [],
      constraints: [],
      indexes: known?.indexes ?? [],
      mermaidId: entity.id
    };
    for (const field of entity.columns) {
      const previous = known?.columns.find((column) => column.mermaidName === field.name);
      const typeChanged = previous && previous.mermaidType !== field.type;
      if (typeChanged)
        warnings.push(
          `${entity.id}.${field.name}: type changed; imported default/generated expressions were discarded.`
        );
      const column: SqlColumn =
        previous && !typeChanged
          ? { ...previous }
          : {
              name: previous?.name ?? field.name,
              nullable: previous?.nullable ?? true,
              type: field.type.replace(/\((\d+)_+(\d+)\)/g, '($1,$2)').replaceAll('_', ' ')
            };
      if ((!previous || typeChanged) && field.type === 'custom_type') {
        column.type = 'TEXT';
        warnings.push(
          `${entity.id}.${field.name}: custom_type has no matching SQL metadata; exported as TEXT.`
        );
      }
      if (!original && dialect === 'mysql') {
        const type = column.type.toLowerCase();
        const mapped = (
          {
            bigserial: 'BIGINT',
            bytea: 'LONGBLOB',
            'double precision': 'DOUBLE',
            jsonb: 'JSON',
            serial: 'INT',
            smallserial: 'SMALLINT',
            timestamptz: 'TIMESTAMP',
            uuid: 'CHAR(36)'
          } as Record<string, string>
        )[type];
        if (mapped) {
          column.type = mapped;
          if (type.includes('serial')) column.autoIncrement = true;
          warnings.push(`${entity.id}.${field.name}: ${type} mapped to MySQL ${mapped}.`);
        }
      }
      if (field.keys.includes('PK')) column.nullable = false;
      table.columns.push(column);
    }
    const retainedNames = new Set(table.columns.map((column) => column.name));
    const keys = (kind: string): string[] =>
      entity.columns
        .filter((column) => column.keys.includes(kind))
        .map(
          (column) =>
            known?.columns.find((item) => item.mermaidName === column.name)?.name ?? column.name
        );
    const primary = keys('PK');
    if (primary.length)
      table.constraints.push({
        columns: primary,
        kind: 'primary',
        name: known?.constraints.find((constraint) => constraint.kind === 'primary')?.name
      });
    const unique = keys('UK');
    const preservedUnique =
      known?.constraints.filter(
        (constraint) =>
          constraint.kind === 'unique' && constraint.columns.every((name) => unique.includes(name))
      ) ?? [];
    table.constraints.push(...preservedUnique);
    for (const column of unique)
      if (
        !known?.constraints.some(
          (constraint) => constraint.kind === 'unique' && constraint.columns.includes(column)
        )
      )
        table.constraints.push({ columns: [column], kind: 'unique' });
    if (
      known?.constraints.some(
        (constraint) =>
          constraint.kind === 'unique' &&
          constraint.columns.some((column) => unique.includes(column)) &&
          !constraint.columns.every((column) => unique.includes(column))
      )
    )
      warnings.push(
        `${entity.id}: a composite UNIQUE constraint lost a column/tag and was omitted rather than narrowed.`
      );
    if (known) {
      const unchangedFields =
        known.columns.length === table.columns.length &&
        entity.columns.every((field) =>
          known.columns.some(
            (column) => column.mermaidName === field.name && column.mermaidType === field.type
          )
        );
      if (unchangedFields)
        table.constraints.push(
          ...known.constraints.filter((constraint) => constraint.kind === 'check')
        );
      else if (known.constraints.some((constraint) => constraint.kind === 'check'))
        warnings.push(
          `${entity.id}: CHECK expressions omitted after column changes; review them against the new schema.`
        );
      if (!unchangedFields)
        for (const column of table.columns)
          if (column.generated) {
            column.generated = undefined;
            warnings.push(
              `${entity.id}.${column.name}: generated expression omitted after field changes; review its dependencies.`
            );
          }
      for (const fk of known.constraints.filter((constraint) => constraint.kind === 'foreign')) {
        const parent = original?.tables.find(
          (target) => fk.references && nameKey(target) === nameKey(fk.references)
        );
        const relationPresent =
          !parent ||
          diagram.relations.some(
            (relation) =>
              relation.from === parent.mermaidId &&
              relation.to === entity.id &&
              relation.label === fk.relationLabel
          );
        const fkKeys = keys('FK');
        if (
          relationPresent &&
          fk.columns.every((column) => retainedNames.has(column) && fkKeys.includes(column))
        )
          table.constraints.push({ ...fk });
      }
    }
    if (!table.columns.length)
      warnings.push(`${entity.id} has no field definitions and cannot be exported as a SQL table.`);
    schema.tables.push(table);
    lookup.set(entity.id, table);
  }
  for (const table of schema.tables) {
    table.constraints = table.constraints.filter((constraint) => {
      if (constraint.kind !== 'foreign' || !constraint.references) return true;
      const originalTarget = original?.tables.find(
        (target) => nameKey(target) === nameKey(constraint.references as SqlName)
      );
      if (
        originalTarget &&
        !schema.tables.some(
          (target) => nameKey(target) === nameKey(originalTarget) && target.columns.length
        )
      ) {
        warnings.push(
          `${displayName(table)}: FK ${constraint.name ?? ''} references a removed/empty entity and was omitted.`
        );
        return false;
      }
      return true;
    });
  }
  for (const relation of diagram.relations) {
    const child = lookup.get(relation.to),
      parent = lookup.get(relation.from);
    if (!child || !parent) continue;
    if (
      child.constraints.some(
        (constraint) => constraint.kind === 'foreign' && constraint.relationLabel === relation.label
      )
    )
      continue;
    // Explicit mapping convention for hand-authored ERDs. Never infer from names
    // such as "has" or "owns": Mermaid cardinality does not identify FK columns.
    const mapping = relation.label.match(/^([\w,\s]+)\s*->\s*([\w,\s]+)$/);
    if (mapping) {
      const childFields = mapping[1].split(',').map((name) => name.trim()),
        parentFields = mapping[2].split(',').map((name) => name.trim());
      const resolve = (table: SqlTable, names: string[]) =>
        names.map(
          (name) =>
            table.columns.find((column) => (column.mermaidName ?? column.name) === name)?.name
        );
      const columns = resolve(child, childFields),
        referencedColumns = resolve(parent, parentFields);
      if (
        columns.length === referencedColumns.length &&
        columns.every((name): name is string => Boolean(name)) &&
        referencedColumns.every((name): name is string => Boolean(name))
      ) {
        child.constraints.push({
          columns,
          kind: 'foreign',
          referencedColumns,
          references: { name: parent.name, schema: parent.schema }
        });
        continue;
      }
    }
    warnings.push(
      `Relationship ${relation.from} → ${relation.to} (${relation.label}) has no physical FK mapping; omitted. Use a label "child_column -> parent_column" to supply one.`
    );
  }
  schema.sequences = schema.sequences.filter((sequence) => {
    if (!sequence.ownedBy) return true;
    return schema.tables.some(
      (table) =>
        nameKey(table) === nameKey(sequence.ownedBy?.table as SqlName) &&
        table.columns.some((column) => column.name === sequence.ownedBy?.column)
    );
  });
  if (!schema.tables.some((table) => table.columns.length))
    throw new Error('No entity fields found. Define columns before exporting SQL.');
  const result = writeSqlSchema(schema, dialect);
  return { sql: result.sql, warnings: [...new Set([...warnings, ...result.warnings])] };
};
