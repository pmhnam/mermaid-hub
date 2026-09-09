import { describe, expect, it } from 'vitest';
import {
  folderDescendantIds,
  removeTreeDiagram,
  removeTreeFolder,
  replaceTreeDiagram,
  replaceTreeFolder,
  toTreeRows
} from './tree';
import type { Diagram, Folder, WorkspaceTree } from './types';

const common = { createdAt: '', deletedAt: null, updatedAt: '' };

describe('toTreeRows', () => {
  it('orders root and nested entries from the flat API response', () => {
    const folders = [
      {
        ...common,
        createdById: 'u',
        id: 'child',
        name: 'Child',
        parentId: 'root',
        path: 'a.b',
        workspaceId: 'w'
      },
      {
        ...common,
        createdById: 'u',
        id: 'root',
        name: 'Root',
        parentId: null,
        path: 'a',
        workspaceId: 'w'
      }
    ] satisfies Folder[];
    const diagrams = [
      {
        ...common,
        currentConfig: '',
        currentContent: '',
        currentVersionId: null,
        folderId: 'child',
        id: 'nested',
        ownerId: 'u',
        title: 'Nested',
        versionSeq: 0,
        workspaceId: 'w'
      },
      {
        ...common,
        currentConfig: '',
        currentContent: '',
        currentVersionId: null,
        folderId: null,
        id: 'loose',
        ownerId: 'u',
        title: 'Loose',
        versionSeq: 0,
        workspaceId: 'w'
      }
    ] satisfies Diagram[];
    const tree = {
      diagrams,
      folders,
      workspace: { ...common, id: 'w', kind: 'personal', name: 'Workspace', ownerId: 'u' }
    } satisfies WorkspaceTree;

    expect(
      toTreeRows(tree).map(({ depth, diagram, folder }) => [depth, folder?.name ?? diagram?.title])
    ).toEqual([
      [0, 'Root'],
      [1, 'Child'],
      [2, 'Nested'],
      [0, 'Loose']
    ]);
  });

  it('updates moved folders and diagrams without nesting the API response', () => {
    const tree = makeTree();
    const movedFolder = { ...tree.folders[1], parentId: null };
    const movedDiagram = { ...tree.diagrams[0], folderId: tree.folders[0].id };
    const updated = replaceTreeDiagram(replaceTreeFolder(tree, movedFolder), movedDiagram);

    expect(updated.folders.map(({ id, parentId }) => [id, parentId])).toEqual([
      ['root', null],
      ['child', null]
    ]);
    expect(updated.diagrams[0].folderId).toBe('root');
    expect(tree.folders[1].parentId).toBe('root');
  });

  it('removes a folder subtree and only its diagrams', () => {
    const tree = makeTree();
    expect([...folderDescendantIds(tree.folders, 'root')]).toEqual(['root', 'child']);
    expect(removeTreeFolder(tree, 'root')).toMatchObject({ diagrams: [], folders: [] });
    expect(removeTreeDiagram(tree, 'nested').diagrams).toEqual([]);
  });
});

const makeTree = (): WorkspaceTree => ({
  diagrams: [
    {
      ...common,
      currentConfig: '',
      currentContent: '',
      currentVersionId: null,
      folderId: 'child',
      id: 'nested',
      ownerId: 'u',
      title: 'Nested',
      versionSeq: 0,
      workspaceId: 'w'
    }
  ],
  folders: [
    {
      ...common,
      createdById: 'u',
      id: 'root',
      name: 'Root',
      parentId: null,
      path: 'a',
      workspaceId: 'w'
    },
    {
      ...common,
      createdById: 'u',
      id: 'child',
      name: 'Child',
      parentId: 'root',
      path: 'a.b',
      workspaceId: 'w'
    }
  ],
  workspace: { ...common, id: 'w', kind: 'personal', name: 'Workspace', ownerId: 'u' }
});
