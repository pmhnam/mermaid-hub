import { describe, expect, it } from 'vitest';
import { parseSqlSchema } from './parseSql';
import { exportErSql, importSql } from './mermaidSql';
import { writeSqlSchema } from './writeSql';
import { postgresDdl, mysqlDdl } from './fixtures';
import { splitTopLevel, tokenize } from './lexer';

describe('SQL DDL conversion', () => {
  it('splits nested expressions and quoted delimiters without losing quoted identifiers', () => {
    const input = `/* multi ; , */ CREATE TABLE "Odd; table" ("id" int, text text DEFAULT 'x;y,z', value numeric(10,2)); COMMENT ON TABLE "Odd; table" IS $$test; text$$;`;
    expect(splitTopLevel(tokenize(input, 'postgresql'), ';')).toHaveLength(2);
    const result = parseSqlSchema(input, 'postgresql');
    expect(result.schema.tables[0].name).toBe('Odd; table');
    expect(result.schema.tables[0].columns).toHaveLength(3);
    expect(result.schema.tables[0].comment).toBe('test; text');
  });
  it('imports PostgreSQL composite constraints, identities, defaults, comments and indexes', () => {
    const { schema, warnings } = parseSqlSchema(postgresDdl, 'postgresql');
    expect(warnings).toEqual([]);
    expect(schema.tables).toHaveLength(2);
    expect(schema.enums[0].values).toEqual(['draft', 'active']);
    const product = schema.tables[0];
    expect(product.columns.find((col) => col.name === 'id')?.identity).toEqual({ always: false });
    expect(product.columns.find((col) => col.name === 'price')?.type).toBe('numeric(12, 2)');
    expect(product.columns.find((col) => col.name === 'name')).toMatchObject({
      comment: 'Display name',
      defaultSql: "'unnamed, item; ok'",
      nullable: false
    });
    expect(schema.tables[1].constraints.find((c) => c.kind === 'foreign')).toMatchObject({
      columns: ['tenant_id', 'product_id'],
      deferrable: true,
      initiallyDeferred: true,
      onDelete: 'CASCADE',
      referencedColumns: ['tenant_id', 'id'],
      references: { name: 'products', schema: 'catalog' }
    });
    expect(schema.tables[1].indexes[0].columns).toEqual([{ name: 'product_id', order: 'DESC' }]);
  });
  it('imports MySQL/MariaDB auto_increment, enum, keys, actions and table options', () => {
    const { schema, warnings } = parseSqlSchema(mysqlDdl, 'mysql');
    expect(warnings).toEqual([]);
    expect(schema.tables[0]).toMatchObject({
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci',
      comment: 'Products',
      engine: 'InnoDB',
      name: 'products',
      schema: 'shop'
    });
    expect(schema.tables[0].columns[0]).toMatchObject({
      type: 'bigint unsigned',
      autoIncrement: true,
      nullable: false
    });
    expect(schema.tables[1].constraints.find((c) => c.kind === 'foreign')?.onDelete).toBe(
      'SET NULL'
    );
  });
  for (const [dialect, ddl] of [
    ['postgresql', postgresDdl],
    ['mysql', mysqlDdl]
  ] as const) {
    it(`round-trips ${dialect} DDL through editable Mermaid without losing supported metadata`, () => {
      const imported = importSql(ddl, dialect);
      expect(imported.tables).toBe(2);
      expect(imported.relationships).toBe(1);
      const exported = exportErSql(imported.code, dialect);
      expect(
        exported.warnings.every((warning) => warning.startsWith('Defaults, nullability'))
      ).toBe(true);
      const normalized = parseSqlSchema(
        writeSqlSchema(parseSqlSchema(ddl, dialect).schema, dialect).sql,
        dialect
      );
      const actual = parseSqlSchema(exported.sql, dialect).schema;
      for (const table of [...actual.tables, ...normalized.schema.tables])
        table.constraints.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      expect(actual).toEqual(normalized.schema);
    });
  }
  it('applies visible field edits and deletion instead of exporting a stale schema', () => {
    const imported = importSql(
      "CREATE TABLE users (id integer PRIMARY KEY, name varchar(100) NOT NULL DEFAULT 'new', email text);",
      'postgresql'
    );
    const updated = imported.code
      .replace('varchar(100) name', 'varchar(200) name')
      .replace(/.*text email.*\n/, '');
    const result = exportErSql(updated, 'postgresql');
    const table = parseSqlSchema(result.sql, 'postgresql').schema.tables[0];
    expect(table.columns.map((col) => col.name)).toEqual(['id', 'name']);
    expect(table.columns[1].type).toBe('varchar(200)');
    expect(table.columns[1].defaultSql).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('type changed');
  });
  it('removes a physical FK when its visible relationship is removed', () => {
    const imported = importSql(mysqlDdl, 'mysql');
    const code = imported.code
      .split('\n')
      .filter((line) => !line.includes('--'))
      .join('\n');
    expect(exportErSql(code, 'mysql').sql).not.toContain('FOREIGN KEY');
  });
  it('exports hand-authored ER fields and only explicit relationship column mappings', () => {
    const result = exportErSql(
      'erDiagram\nUSER {\n int id PK\n}\nPOST {\n int id PK\n int user_id FK\n}\nUSER ||--o{ POST : "user_id -> id"',
      'postgresql'
    );
    expect(result.sql).toContain('FOREIGN KEY ("user_id") REFERENCES "USER" ("id")');
    const ambiguous = exportErSql(
      'erDiagram\nA {\n int id PK\n}\nB {\n int id PK\n}\nA ||--o{ B : has',
      'mysql'
    );
    expect(ambiguous.sql).not.toContain('FOREIGN KEY');
    expect(ambiguous.warnings.join(' ')).toContain('no physical FK mapping');
  });
  it('converts common types across dialects and reports lossy conversions', () => {
    const result = exportErSql(importSql(postgresDdl, 'postgresql').code, 'mysql');
    expect(result.sql).toContain('CHAR(36)');
    expect(result.sql).toContain('AUTO_INCREMENT');
    expect(result.sql).toContain("ENUM('draft', 'active')");
    expect(result.warnings.join(' ')).toContain('Timezone');
    const postgres = exportErSql(importSql(mysqlDdl, 'mysql').code, 'postgresql');
    expect(postgres.sql).toContain('GENERATED BY DEFAULT AS IDENTITY');
    expect(postgres.sql).toContain('BOOLEAN NOT NULL DEFAULT TRUE');
    expect(postgres.warnings.join(' ')).toContain('UNSIGNED');
  });
  it('does not keep INSERT data or unsupported functions in the metadata', () => {
    const result = importSql(
      'CREATE TABLE users(id int); INSERT INTO users VALUES (987654); CREATE FUNCTION x() RETURNS int AS $$SELECT 987654;$$ LANGUAGE SQL;',
      'postgresql'
    );
    const exported = exportErSql(result.code, 'postgresql');
    expect(exported.sql).not.toContain('987654');
    expect(exported.sql).not.toContain('FUNCTION');
    expect(result.warnings.some((warning) => warning.includes('INSERT'))).toBe(true);
  });
  it('handles identity and default declarations emitted separately by pg_dump', () => {
    const sql = `CREATE TABLE public.t(id bigint NOT NULL, n integer); ALTER TABLE public.t ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (START WITH 10); ALTER TABLE ONLY public.t ADD CONSTRAINT t_pk PRIMARY KEY(id); ALTER TABLE public.t ALTER COLUMN n SET DEFAULT 5;`;
    const result = exportErSql(importSql(sql, 'postgresql').code, 'postgresql');
    expect(result.sql).toContain('GENERATED ALWAYS AS IDENTITY (START WITH 10)');
    expect(result.sql).toContain('DEFAULT 5');
  });
  it('handles cyclic foreign keys by emitting them after all table definitions', () => {
    const result = exportErSql(
      importSql(
        'CREATE TABLE a(id int PRIMARY KEY,b int REFERENCES b(id)); CREATE TABLE b(id int PRIMARY KEY,a int REFERENCES a(id));',
        'postgresql'
      ).code,
      'postgresql'
    );
    expect(result.sql.lastIndexOf('CREATE TABLE')).toBeLessThan(result.sql.indexOf('ALTER TABLE'));
    expect(
      parseSqlSchema(result.sql, 'postgresql')
        .schema.tables.flatMap((table) => table.constraints)
        .filter((c) => c.kind === 'foreign')
    ).toHaveLength(2);
  });
  it('rejects malformed definitions instead of importing a partially broken table', () => {
    expect(() => importSql('CREATE TABLE bad(id);', 'mysql')).toThrow('Missing type');
    expect(() => importSql("CREATE TABLE bad(id text DEFAULT 'missing);", 'postgresql')).toThrow(
      'Unterminated'
    );
    expect(() => exportErSql('flowchart LR\nA-->B', 'postgresql')).toThrow('ER diagram');
  });
  it('keeps pg_dump sequences, ownership and defaults through the round trip', () => {
    const sql = `CREATE TABLE public.seq_table (id integer NOT NULL); CREATE SEQUENCE public.seq_table_id_seq AS integer START WITH 10 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1; ALTER SEQUENCE public.seq_table_id_seq OWNED BY public.seq_table.id; ALTER TABLE ONLY public.seq_table ALTER COLUMN id SET DEFAULT nextval('public.seq_table_id_seq'::regclass); ALTER TABLE ONLY public.seq_table ADD CONSTRAINT seq_pk PRIMARY KEY(id);`;
    const result = exportErSql(importSql(sql, 'postgresql').code, 'postgresql');
    expect(result.sql).toContain('CREATE SEQUENCE');
    expect(result.sql).toContain("DEFAULT nextval('public.seq_table_id_seq'::regclass)");
    expect(result.sql).toContain('OWNED BY "public"."seq_table"."id"');
  });
  it('imports generated expressions, partial indexes and INCLUDE without splitting their commas', () => {
    const sql = `CREATE TABLE t (a int, b int, total int GENERATED ALWAYS AS (a + b) STORED); CREATE INDEX positive ON t(a) INCLUDE(b) WHERE a > 0;`;
    const result = exportErSql(importSql(sql, 'postgresql').code, 'postgresql');
    expect(result.sql).toContain('GENERATED ALWAYS AS (a + b) STORED');
    expect(result.sql).toContain('INCLUDE ("b") WHERE a > 0');
    const mysql = exportErSql(
      importSql('CREATE TABLE t(a int, total int AS (a + 2) STORED);', 'mysql').code,
      'mysql'
    );
    expect(mysql.sql).toContain('GENERATED ALWAYS AS (a + 2) STORED');
  });
  it('places an AUTO_INCREMENT supporting index inside the MySQL CREATE TABLE', () => {
    const result = exportErSql(
      importSql('CREATE TABLE t(id int NOT NULL AUTO_INCREMENT, KEY auto_key(id));', 'mysql').code,
      'mysql'
    );
    expect(result.sql).toContain('KEY `auto_key` (`id`)\n)');
    expect(result.sql).not.toContain('CREATE INDEX `auto_key`');
  });
  it('maps UUID fields in a hand-authored ERD to MySQL without guessing a foreign key', () => {
    const result = exportErSql('erDiagram\nPRODUCT {\n UUID id PK\n JSONB details\n}', 'mysql');
    expect(result.sql).toContain('`id` CHAR(36) NOT NULL');
    expect(result.sql).toContain('`details` JSON');
  });
  it('reports loss of a composite unique key instead of creating a narrower uniqueness rule', () => {
    const imported = importSql('CREATE TABLE t (a int, b int, UNIQUE(a,b));', 'postgresql');
    const result = exportErSql(imported.code.replace(/.*int b UK.*\n/, ''), 'postgresql');
    expect(result.sql).not.toContain('UNIQUE');
    expect(result.warnings.join(' ')).toContain('composite UNIQUE');
  });
});
