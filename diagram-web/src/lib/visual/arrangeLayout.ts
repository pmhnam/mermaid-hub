import type { Bounds } from './canvasGraph';
import { completeAssignments, type ArrangeGraph, type TableAssignment } from './arrangement';
import type { VisualLayout } from './layout';

export interface ArrangeNode extends Bounds {
  id: string;
}
export interface ArrangePreview {
  height: number;
  layout: VisualLayout;
  nodes: ArrangeNode[];
  width: number;
}

interface PackedItem {
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
}

const pack = (
  items: { height: number; id: string; width: number }[],
  columns: number,
  gap: number
): { height: number; items: PackedItem[]; width: number } => {
  const packed: PackedItem[] = [];
  let y = 0;
  let width = 0;
  for (let start = 0; start < items.length; start += columns) {
    const row = items.slice(start, start + columns);
    const rowHeight = Math.max(...row.map((item) => item.height));
    let x = 0;
    for (const item of row) {
      packed.push({ ...item, x, y });
      x += item.width + gap;
    }
    width = Math.max(width, Math.max(0, x - gap));
    y += rowHeight + gap;
  }
  return { height: Math.max(0, y - gap), items: packed, width };
};

const columnCount = (count: number, direction: 'RIGHT' | 'DOWN'): number =>
  Math.max(1, Math.ceil(Math.sqrt(count * (direction === 'RIGHT' ? 1.5 : 0.67))));

/** Pack tables inside databases, databases inside services, then services on the canvas. */
export const arrangeLayout = async (
  graph: ArrangeGraph,
  assignments: TableAssignment[],
  measured: ArrangeNode[],
  current: VisualLayout,
  direction: 'RIGHT' | 'DOWN',
  spacing: number
): Promise<ArrangePreview> => {
  const groups = completeAssignments(
    graph.tables.map((table) => table.id),
    assignments
  );
  const measuredById = new Map(measured.map((node) => [node.id, node]));
  if (
    measured.length !== graph.tables.length ||
    graph.tables.some((table) => !measuredById.has(table.id))
  )
    throw new Error('The rendered tables do not match the source. Refresh the diagram and retry.');

  const connections = new Map<string, number>();
  for (const edge of graph.edges) {
    connections.set(edge.source, (connections.get(edge.source) ?? 0) + 1);
    connections.set(edge.target, (connections.get(edge.target) ?? 0) + 1);
  }
  const services = new Map<string, Map<string, string[]>>();
  for (const assignment of groups) {
    let databases = services.get(assignment.service);
    if (!databases) {
      databases = new Map();
      services.set(assignment.service, databases);
    }
    databases.set(assignment.database, [
      ...(databases.get(assignment.database) ?? []),
      assignment.tableId
    ]);
  }

  const tablePositions = new Map<string, { x: number; y: number }>();
  const serviceBoxes = [...services]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([serviceName, databases]) => {
      const databaseBoxes = [...databases]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([databaseName, ids]) => {
          const tables = ids
            .map((id) => measuredById.get(id))
            .filter((node): node is ArrangeNode => Boolean(node))
            .sort(
              (a, b) =>
                (connections.get(b.id) ?? 0) - (connections.get(a.id) ?? 0) ||
                a.id.localeCompare(b.id)
            );
          const result = pack(tables, columnCount(tables.length, direction), spacing);
          return {
            height: result.height + 65,
            id: `${serviceName}\u0000${databaseName}`,
            tables: result.items.map((item) => ({ id: item.id, x: item.x + 20, y: item.y + 45 })),
            width: result.width + 40
          };
        });
      const result = pack(
        databaseBoxes,
        columnCount(databaseBoxes.length, direction),
        spacing * 1.5
      );
      return {
        databases: result.items.map((item) => ({
          ...item,
          tables: databaseBoxes.find((database) => database.id === item.id)?.tables ?? []
        })),
        height: result.height,
        id: serviceName,
        width: result.width
      };
    });

  const canvas = pack(serviceBoxes, columnCount(serviceBoxes.length, direction), spacing * 2);
  for (const service of canvas.items) {
    const databases = serviceBoxes.find((item) => item.id === service.id)?.databases ?? [];
    for (const database of databases)
      for (const table of database.tables)
        tablePositions.set(table.id, {
          x: service.x + database.x + table.x,
          y: service.y + database.y + table.y
        });
  }
  const nodes = measured.map((node) => {
    const position = tablePositions.get(node.id);
    if (!position) throw new Error(`Layout did not position ${node.id}.`);
    return { ...node, ...position };
  });
  const offsets = Object.fromEntries(
    nodes.map((node, index) => [
      node.id,
      {
        x: (current.offsets[node.id]?.x ?? 0) + node.x - measured[index].x,
        y: (current.offsets[node.id]?.y ?? 0) + node.y - measured[index].y
      }
    ])
  );
  return {
    height: canvas.height,
    layout: {
      arrangement: { assignments: groups, version: 1 },
      engine: current.engine,
      mode: 'manual',
      offsets
    },
    nodes,
    width: canvas.width
  };
};
