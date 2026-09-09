import { describe, expect, it } from 'vitest';
import { initialAuthState, reduceAuthState } from './auth-state';

describe('auth state', () => {
  it('moves between authenticated, loading, and anonymous states', () => {
    const user = { displayName: 'Ada', email: 'ada@example.com', id: 'user-1' };
    const authenticated = reduceAuthState(initialAuthState, { type: 'authenticated', user });
    expect(authenticated).toEqual({ status: 'authenticated', user });
    expect(reduceAuthState(authenticated, { type: 'loading' })).toEqual(initialAuthState);
    expect(reduceAuthState(authenticated, { type: 'anonymous' })).toEqual({
      status: 'anonymous',
      user: null
    });
  });
});
