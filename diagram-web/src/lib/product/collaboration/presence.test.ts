import { describe, expect, it } from 'vitest';
import { presenceColor, presenceInitials } from './presence';

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
});
