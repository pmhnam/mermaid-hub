import { pinoHttpOptions } from './logger.js';

describe('structured logging', () => {
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
