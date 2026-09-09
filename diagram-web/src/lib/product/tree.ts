import type { Diagram, Folder, WorkspaceTree } from './types';

export interface TreeRow {
  depth: number;
  diagram?: Diagram;
  folder?: Folder;
}

export const folderDescendantIds = (folders: Folder[], folderId: string): Set<string> => {
  const descendants = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && descendants.has(folder.parentId) && !descendants.has(folder.id)) {
        descendants.add(folder.id);
        changed = true;
      }
    }
  }
  return descendants;
};

export const replaceTreeFolder = (tree: WorkspaceTree, updated: Folder): WorkspaceTree => ({
  ...tree,
  folders: tree.folders.map((folder) => (folder.id === updated.id ? updated : folder))
});

export const replaceTreeDiagram = (tree: WorkspaceTree, updated: Diagram): WorkspaceTree => ({
  ...tree,
  diagrams: tree.diagrams.map((diagram) => (diagram.id === updated.id ? updated : diagram))
});

export const removeTreeFolder = (tree: WorkspaceTree, folderId: string): WorkspaceTree => {
  const removed = folderDescendantIds(tree.folders, folderId);
  return {
    ...tree,
    diagrams: tree.diagrams.filter(
      (diagram) => !diagram.folderId || !removed.has(diagram.folderId)
    ),
    folders: tree.folders.filter((folder) => !removed.has(folder.id))
  };
};

export const removeTreeDiagram = (tree: WorkspaceTree, diagramId: string): WorkspaceTree => ({
  ...tree,
  diagrams: tree.diagrams.filter((diagram) => diagram.id !== diagramId)
});

export const toTreeRows = ({ diagrams, folders }: WorkspaceTree): TreeRow[] => {
  const rows: TreeRow[] = [];
  const foldersByParent = new Map<string | null, Folder[]>();
  const diagramsByFolder = new Map<string | null, Diagram[]>();
  for (const folder of folders) {
    foldersByParent.set(folder.parentId, [...(foldersByParent.get(folder.parentId) ?? []), folder]);
  }
  for (const diagram of diagrams) {
    diagramsByFolder.set(diagram.folderId, [
      ...(diagramsByFolder.get(diagram.folderId) ?? []),
      diagram
    ]);
  }
  const byName = <T extends { name?: string; title?: string }>(left: T, right: T) =>
    (left.name ?? left.title ?? '').localeCompare(right.name ?? right.title ?? '');

  const visit = (parentId: string | null, depth: number): void => {
    for (const folder of (foldersByParent.get(parentId) ?? []).toSorted(byName)) {
      rows.push({ depth, folder });
      visit(folder.id, depth + 1);
    }
    for (const diagram of (diagramsByFolder.get(parentId) ?? []).toSorted(byName)) {
      rows.push({ depth, diagram });
    }
  };

  visit(null, 0);
  return rows;
};
