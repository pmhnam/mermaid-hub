import { diffLines, type Change } from 'diff';

export interface VersionDiff {
  config: Change[];
  content: Change[];
}

export const createVersionDiff = (
  current: { config: string; content: string },
  version: { config: string; content: string }
): VersionDiff => ({
  config: diffLines(current.config, version.config),
  content: diffLines(current.content, version.content)
});
