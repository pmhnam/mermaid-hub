import { pinoHttpOptions } from './logger.js';

describe('structured logging', () => {
  it('removes OAuth codes and state from logged URLs', () => {
    expect(
      pinoHttpOptions.serializers.req({
        url: '/api/auth/google/callback?code=secret&state=secret',
      }).url,
    ).toBe('/api/auth/google/callback');
  });
  it('redacts credentials and token fields and is silent in tests', () => {
    expect(pinoHttpOptions.level).toBe('silent');
    expect(pinoHttpOptions.redact.paths).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.refreshToken',
        'req.body.accessToken',
        'res.headers["set-cookie"]',
        'passwordHash',
        'refreshToken',
        'accessToken',
      ]),
    );
  });
});
