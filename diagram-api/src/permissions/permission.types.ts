export enum ResourceRole {
  Viewer = 'viewer',
  Editor = 'editor',
  Owner = 'owner',
}

export const resourceRoleRank: Record<ResourceRole, number> = {
  [ResourceRole.Viewer]: 1,
  [ResourceRole.Editor]: 2,
  [ResourceRole.Owner]: 3,
};

export function resourceRoleAllows(
  actual: ResourceRole,
  required: ResourceRole,
): boolean {
  return resourceRoleRank[actual] >= resourceRoleRank[required];
}
