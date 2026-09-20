export type SqlDialect = 'postgresql' | 'mysql';
export interface SqlName {
  name: string;
  schema?: string;
}
export interface SqlColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultSql?: string;
  autoIncrement?: boolean;
  identity?: { always: boolean; options?: string };
  generated?: { expression: string; storage: 'STORED' | 'VIRTUAL' };
  comment?: string;
  onUpdate?: string;
  collation?: string;
  charset?: string;
  mermaidName?: string;
  mermaidType?: string;
}
export type ReferentialAction = 'CASCADE' | 'RESTRICT' | 'NO ACTION' | 'SET NULL' | 'SET DEFAULT';
export interface SqlConstraint {
  kind: 'primary' | 'unique' | 'foreign' | 'check';
  name?: string;
  columns: string[];
  references?: SqlName;
  referencedColumns?: string[];
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  expression?: string;
  deferrable?: boolean;
  initiallyDeferred?: boolean;
  match?: 'FULL' | 'SIMPLE';
  relationLabel?: string;
}
export interface SqlIndex {
  name: string;
  columns: { name: string; order?: 'ASC' | 'DESC'; length?: number }[];
  unique: boolean;
  method?: string;
  where?: string;
  include?: string[];
}
export interface SqlTable extends SqlName {
  columns: SqlColumn[];
  constraints: SqlConstraint[];
  indexes: SqlIndex[];
  comment?: string;
  engine?: string;
  charset?: string;
  collation?: string;
  mermaidId?: string;
}
export interface SqlEnum extends SqlName {
  values: string[];
}
export interface SqlSequence extends SqlName {
  definition: string;
  ownedBy?: { table: SqlName; column: string };
}
export interface SqlSchema {
  version: 1;
  dialect: SqlDialect;
  tables: SqlTable[];
  enums: SqlEnum[];
  sequences: SqlSequence[];
}
export interface SqlResult {
  schema: SqlSchema;
  warnings: string[];
}
export const nameKey = (name: SqlName): string => JSON.stringify([name.schema ?? '', name.name]);
export const displayName = (name: SqlName): string =>
  name.schema ? `${name.schema}.${name.name}` : name.name;
