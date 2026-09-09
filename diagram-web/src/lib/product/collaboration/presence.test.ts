import { describe, expect, it } from 'vitest';
import { presenceColor, presenceInitials, presenceRevision, readPreviewCursors } from './presence';

describe('presence formatting', () => {
  it('creates readable initials', () => {
    expect(presenceInitials('Ada Lovelace')).toBe('AL');
    expect(presenceInitials(' Prince ')).toBe('PR');
    expect(presenceInitials('')).toBe('?');
  });

  it('assigns a stable palette color by user id', () => {
    expect(presenceColor('user-1')).toBe(presenceColor('user-1'));
    expect(presenceColor('user-1')).toMatch(/^#[\da-f]{6}$/);
  });

  it('creates a stable revision without including diagram content', () => {
    expect(presenceRevision('A-->B', '{}')).toBe(presenceRevision('A-->B', '{}'));
    expect(presenceRevision('A-->C', '{}')).not.toBe(presenceRevision('A-->B', '{}'));
  });

  it('reads valid remote SVG cursors and ignores malformed coordinates', () => {
    const awareness = {
      getStates: () =>
        new Map([
          [1, { user: { color: 'url(https://bad.test)', displayName: ' Ada ', userId: 'ada' } }],
          [
            2,
            {
              previewCursor: { revision: 'revision-1', x: 12, y: 24 },
              user: { color: 'url(https://bad.test)', displayName: ' Grace ', userId: 'grace' }
            }
          ],
          [
            3,
            {
              previewCursor: { revision: 'revision-1', x: Number.NaN, y: 24 },
              user: { color: '#ffffff', displayName: 'Invalid', userId: 'invalid' }
            }
          ]
        ])
    };

    expect(readPreviewCursors(awareness as never, 1)).toEqual([
      {
        clientId: 2,
        color: presenceColor('grace'),
        displayName: 'Grace',
        name: 'Grace',
        revision: 'revision-1',
        userId: 'grace',
        x: 12,
        y: 24
      }
    ]);
  });
});
