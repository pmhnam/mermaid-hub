import { WorkspaceRole } from '../workspaces/entities/workspace-member.entity.js';
import { ResourceRole } from './permission.types.js';
import {
  highestResourceRole,
  PermissionsService,
  roleAllows,
} from './permissions.service.js';

describe('workspace role ordering', () => {
  it('allows owners to perform member and owner actions', () => {
    expect(roleAllows(WorkspaceRole.Owner, WorkspaceRole.Member)).toBe(true);
    expect(roleAllows(WorkspaceRole.Owner, WorkspaceRole.Owner)).toBe(true);
  });

  it('does not allow members to perform owner actions', () => {
    expect(roleAllows(WorkspaceRole.Member, WorkspaceRole.Member)).toBe(true);
    expect(roleAllows(WorkspaceRole.Member, WorkspaceRole.Owner)).toBe(false);
  });
});

describe('resource role ordering', () => {
  it('selects the strongest inherited or direct grant', () => {
    expect(
      highestResourceRole([
        ResourceRole.Viewer,
        ResourceRole.Owner,
        ResourceRole.Editor,
      ]),
    ).toBe(ResourceRole.Owner);
    expect(
      highestResourceRole([ResourceRole.Viewer, ResourceRole.Editor]),
    ).toBe(ResourceRole.Editor);
    expect(highestResourceRole([null, undefined])).toBeNull();
  });

  it('maps the ranked result returned by ancestor grant resolution', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([{ rank: '2' }]) };
    const service = new PermissionsService({} as never, dataSource as never);

    await expect(
      service.resolveDiagramRole('user-id', 'diagram-id'),
    ).resolves.toBe(ResourceRole.Editor);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('ancestor.path @> target.path'),
      ['user-id', 'diagram-id'],
    );
  });

  it('returns no access when no workspace, direct, or ancestor grant wins', async () => {
    const dataSource = { query: vi.fn().mockResolvedValue([]) };
    const service = new PermissionsService({} as never, dataSource as never);

    await expect(
      service.resolveFolderRole('user-id', 'folder-id'),
    ).resolves.toBeNull();
  });
});
