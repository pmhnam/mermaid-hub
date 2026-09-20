import mermaid from 'mermaid';
import type { ArrangeGraph, Arrangement } from './arrangement';

interface ErDatabase {
  getEntities(): Map<string, { id: string; attributes: { name: string; type: string }[] }>;
  getRelationships(): { entityA: string; entityB: string }[];
  getSubGraphs?(): unknown[];
}

/** Use Mermaid's parser, including aliases and relation-only entities, rather than a second grammar. */
export const parseArrangeGraph = async (
  code: string,
  arrangement?: Arrangement
): Promise<ArrangeGraph> => {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
  if (!diagram.type.startsWith('er')) throw new Error('AI Arrange supports ER diagrams.');
  const db = diagram.db as unknown as ErDatabase;
  if (db.getSubGraphs?.().length)
    throw new Error(
      'This ERD already has source-defined groups. Arrange a flat ERD to avoid conflicting group layouts.'
    );
  const entities = [...db.getEntities()];
  if (!entities.length || entities.length > 100) throw new Error('Arrange supports 1–100 tables.');
  const names = new Map(entities.map(([name, entity]) => [entity.id, name]));
  const assignments = new Map(arrangement?.assignments.map((item) => [item.tableId, item]));
  return {
    tables: entities.map(([id, entity]) => {
      const assignment = assignments.get(id);
      return {
        id,
        fields: entity.attributes.map((field) => `${field.name}: ${field.type}`),
        ...(assignment ? { service: assignment.service, database: assignment.database } : {})
      };
    }),
    edges: db.getRelationships().map((edge) => ({
      source: names.get(edge.entityA) ?? edge.entityA,
      target: names.get(edge.entityB) ?? edge.entityB
    }))
  };
};
