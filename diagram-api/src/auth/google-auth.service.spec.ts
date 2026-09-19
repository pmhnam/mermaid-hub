import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { GoogleAuthService } from './google-auth.service.js';

const config = new ConfigService({
  GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'https://app.example/api/auth/google/callback',
  APP_URL: 'https://app.example',
});
const jwt = new JwtService({
  secret: 'test-signing-secret-with-at-least-32-characters',
});

afterEach(() => vi.restoreAllMocks());

describe('Google OAuth sign-in', () => {
  it('uses state, nonce, PKCE and only identity scopes', async () => {
    const service = new GoogleAuthService(config, jwt);
    const attempt = await service.begin();
    const url = new URL(attempt.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(url.searchParams.get('state')).toHaveLength(43);
    expect(url.searchParams.get('nonce')).toHaveLength(43);
    const payload = await jwt.verifyAsync(attempt.cookie, {
      audience: 'google-login',
    });
    expect(payload.exp - payload.iat).toBe(600);
    expect(payload.state).toBe(url.searchParams.get('state'));
  });

  it('verifies audience and nonce before returning an identity', async () => {
    const service = new GoogleAuthService(config, jwt);
    const attempt = await service.begin();
    const url = new URL(attempt.url);
    const exchange = vi
      .spyOn(OAuth2Client.prototype, 'getToken')
      .mockResolvedValue({ tokens: { id_token: 'signed-id-token' } } as never);
    const verify = vi
      .spyOn(OAuth2Client.prototype, 'verifyIdToken')
      .mockResolvedValue({
        getPayload: () => ({
          sub: 'stable-google-subject',
          email: 'ADA@example.com',
          email_verified: true,
          name: 'Ada',
          nonce: url.searchParams.get('nonce'),
        }),
      } as never);
    expect(
      await service.complete(
        'auth-code',
        url.searchParams.get('state'),
        attempt.cookie,
      ),
    ).toEqual({
      subject: 'stable-google-subject',
      email: 'ada@example.com',
      displayName: 'Ada',
    });
    expect(exchange).toHaveBeenCalledWith({
      code: 'auth-code',
      codeVerifier: expect.any(String),
    });
    expect(verify).toHaveBeenCalledWith({
      idToken: 'signed-id-token',
      audience: 'test.apps.googleusercontent.com',
    });
  });

  it('rejects missing, mismatched, expired and tampered state before exchanging tokens', async () => {
    const service = new GoogleAuthService(config, jwt);
    const attempt = await service.begin();
    const state = new URL(attempt.url).searchParams.get('state');
    const exchange = vi.spyOn(OAuth2Client.prototype, 'getToken');
    const expired = await jwt.signAsync(
      { purpose: 'google-login', state },
      { audience: 'google-login', expiresIn: -1 },
    );
    for (const [code, returnedState, cookie] of [
      [undefined, state, attempt.cookie],
      ['code', 'wrong-state', attempt.cookie],
      ['code', state, undefined],
      ['code', state, `${attempt.cookie}tampered`],
      ['code', state, expired],
    ]) {
      await expect(
        service.complete(code, returnedState, cookie),
      ).rejects.toThrow('could not be verified');
    }
    expect(exchange).not.toHaveBeenCalled();
  });

  it.each(['email', 'nonce', 'signature'])(
    'rejects invalid %s',
    async (invalid) => {
      const service = new GoogleAuthService(config, jwt);
      const attempt = await service.begin();
      const url = new URL(attempt.url);
      vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({
        tokens: { id_token: 'token' },
      } as never);
      const verifier = vi.spyOn(OAuth2Client.prototype, 'verifyIdToken');
      if (invalid === 'signature')
        verifier.mockRejectedValue(new Error('Invalid signature'));
      else
        verifier.mockResolvedValue({
          getPayload: () => ({
            sub: 'subject',
            email: 'ada@example.com',
            email_verified: invalid !== 'email',
            nonce:
              invalid === 'nonce' ? 'wrong' : url.searchParams.get('nonce'),
          }),
        } as never);
      await expect(
        service.complete('code', url.searchParams.get('state'), attempt.cookie),
      ).rejects.toThrow('could not be verified');
    },
  );

  it('is disabled without configuration', async () => {
    const service = new GoogleAuthService(new ConfigService({}), jwt);
    expect(service.enabled).toBe(false);
    await expect(service.begin()).rejects.toThrow('not configured');
  });
});
