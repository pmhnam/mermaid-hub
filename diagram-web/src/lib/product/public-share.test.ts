import { describe, expect, it } from 'vitest';
import { isPublicLinkMode, publicGuestIdentity, publicShareToken } from './public-share';

describe('public sharing helpers', () => {
  it('reads raw and named fragment tokens without accepting an empty token', () => {
    expect(publicShareToken('#link.nonce.signature')).toBe('link.nonce.signature');
    expect(publicShareToken('#token=link.nonce.signature')).toBe('link.nonce.signature');
    expect(publicShareToken('')).toBeNull();
  });

  it('keeps a stable guest identity in session storage', () => {
    const storage = new Map<string, string>();
    const session = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      }
    };

    const first = publicGuestIdentity(session, () => 'abcd-1234');
    const second = publicGuestIdentity(session, () => 'unused');

    expect(first).toEqual({ displayName: 'Guest ABCD', id: 'guest:abcd-1234' });
    expect(second).toEqual(first);
  });

  it('only accepts backend public modes', () => {
    expect(isPublicLinkMode('public_read')).toBe(true);
    expect(isPublicLinkMode('public_edit')).toBe(true);
    expect(isPublicLinkMode('owner')).toBe(false);
  });
});
