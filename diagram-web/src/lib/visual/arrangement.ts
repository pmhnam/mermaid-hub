export interface TableAssignment {
  tableId: string;
  service: string;
  database: string;
}

export interface Arrangement {
  version: 1;
  assignments: TableAssignment[];
}

export interface ArrangeGraph {
  tables: { id: string; fields: string[]; service?: string; database?: string }[];
  edges: { source: string; target: string }[];
}

export const parseArrangement = (value: unknown): Arrangement | undefined => {
  if (!value || typeof value !== 'object') return;
  const candidate = value as Partial<Arrangement>;
  if (
    candidate.version !== 1 ||
    !Array.isArray(candidate.assignments) ||
    candidate.assignments.length > 100
  )
    return;
  const seen = new Set<string>();
  for (const item of candidate.assignments) {
    if (
      !item ||
      typeof item.tableId !== 'string' ||
      !item.tableId ||
      item.tableId.length > 256 ||
      seen.has(item.tableId) ||
      typeof item.service !== 'string' ||
      !item.service.trim() ||
      item.service.length > 120 ||
      typeof item.database !== 'string' ||
      !item.database.trim() ||
      item.database.length > 120
    )
      return;
    seen.add(item.tableId);
  }
  return {
    version: 1,
    assignments: candidate.assignments.map((item) => ({
      tableId: item.tableId,
      service: item.service.trim(),
      database: item.database.trim()
    }))
  };
};

export const completeAssignments = (ids: string[], value: unknown): TableAssignment[] => {
  const parsed = parseArrangement({ assignments: value, version: 1 });
  const known = new Set(ids);
  if (
    !parsed ||
    parsed.assignments.length !== ids.length ||
    parsed.assignments.some((item) => !known.has(item.tableId))
  ) {
    throw new Error('Groups must contain every table exactly once.');
  }
  return parsed.assignments;
};
