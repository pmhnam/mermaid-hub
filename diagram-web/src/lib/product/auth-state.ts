import type { User } from './types';

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: User }
  | { status: 'anonymous'; user: null };

export type AuthEvent =
  { type: 'loading' } | { type: 'authenticated'; user: User } | { type: 'anonymous' };

export const initialAuthState: AuthState = { status: 'loading', user: null };

export const reduceAuthState = (_state: AuthState, event: AuthEvent): AuthState => {
  if (event.type === 'authenticated') return { status: 'authenticated', user: event.user };
  if (event.type === 'anonymous') return { status: 'anonymous', user: null };
  return initialAuthState;
};
