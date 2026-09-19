import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller.js';

describe('Google browser session handoff', () => {
  const setup = () => {
    const google = {
      enabled: true,
      begin: vi
        .fn()
        .mockResolvedValue({
          url: 'https://accounts.google.com/auth',
          cookie: 'signed-state',
        }),
      complete: vi.fn().mockResolvedValue({ subject: '123' }),
      resultUrl: (result: string) =>
        `https://app.example/login?google=${result}`,
    };
    const auth = {
      loginWithGoogle: vi
        .fn()
        .mockResolvedValue({
          accessToken: 'private-access-token',
          refreshToken: 'private-refresh-token',
        }),
    };
    const response = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
      setHeader: vi.fn(),
      redirect: vi.fn(),
    };
    const request = {
      cookies: { google_login_attempt: 'signed-state' },
      get: () => undefined,
    };
    const controller = new AuthController(
      auth as never,
      new ConfigService({ COOKIE_SECURE: 'true' }),
      google as never,
    );
    return { google, auth, response, request, controller };
  };

  it('sets a short-lived HttpOnly Lax state cookie for the Google redirect', async () => {
    const { controller, response } = setup();
    await controller.googleStart(response as never);
    expect(response.cookie).toHaveBeenCalledWith(
      'google_login_attempt',
      'signed-state',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 600_000,
      }),
    );
  });

  it('returns only the application refresh cookie and redirects without URL tokens', async () => {
    const { controller, response, request } = setup();
    await controller.googleCallback(
      { code: 'code', state: 'state' },
      request as never,
      response as never,
    );
    expect(response.clearCookie).toHaveBeenCalledWith('google_login_attempt', {
      path: '/api/auth/google',
    });
    expect(response.cookie).toHaveBeenCalledWith(
      expect.any(String),
      'private-refresh-token',
      expect.objectContaining({ httpOnly: true, secure: true }),
    );
    expect(response.redirect).toHaveBeenCalledWith(
      'https://app.example/login?google=success',
    );
  });

  it('does not create an application session when Google verification fails', async () => {
    const { controller, response, request, google, auth } = setup();
    google.complete.mockRejectedValue(new Error('bad token'));
    await controller.googleCallback(
      { error: 'access_denied' },
      request as never,
      response as never,
    );
    expect(auth.loginWithGoogle).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(
      'https://app.example/login?google=cancelled',
    );
  });
});
