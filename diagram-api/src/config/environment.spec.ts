import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.js';

const required = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/test',
  JWT_ACCESS_SECRET: 'test-access-secret-of-at-least-32-characters',
  PUBLIC_LINK_SECRET: 'test-public-secret-of-at-least-32-characters',
};
const google = {
  GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_REDIRECT_URI: 'https://app.example/api/auth/google/callback',
  APP_URL: 'https://app.example',
};

describe('Google environment configuration', () => {
  it('keeps Google optional for existing installations', () => {
    expect(() => validateEnvironment(required)).not.toThrow();
  });
  it('requires a complete configuration', () => {
    expect(() =>
      validateEnvironment({
        ...required,
        GOOGLE_CLIENT_ID: google.GOOGLE_CLIENT_ID,
      }),
    ).toThrow('Google sign-in requires');
  });
  it('accepts complete production settings', () => {
    expect(() =>
      validateEnvironment({ ...required, ...google, NODE_ENV: 'production' }),
    ).not.toThrow();
  });
  it('rejects unsafe callback protocols and HTTP in production', () => {
    for (const uri of [
      'javascript:alert(1)',
      'http://app.example/callback',
      'https://app.example/callback?secret=value',
    ]) {
      expect(() =>
        validateEnvironment({
          ...required,
          ...google,
          NODE_ENV: 'production',
          GOOGLE_REDIRECT_URI: uri,
        }),
      ).toThrow();
    }
  });
});
