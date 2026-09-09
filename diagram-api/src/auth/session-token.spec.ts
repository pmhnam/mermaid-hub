import {
  generateRefreshToken,
  hashRefreshToken,
  parseRefreshSessionId,
  verifyRefreshToken,
} from './session-token.js';

describe('refresh session tokens', () => {
  it('creates opaque tokens that expose only the session lookup id', async () => {
    const generated = generateRefreshToken();
    const storedHash = await hashRefreshToken(generated.token);

    expect(parseRefreshSessionId(generated.token)).toBe(generated.sessionId);
    expect(storedHash).not.toContain(generated.token);
    await expect(verifyRefreshToken(storedHash, generated.token)).resolves.toBe(
      true,
    );
    await expect(
      verifyRefreshToken(storedHash, `${generated.token}changed`),
    ).resolves.toBe(false);
  });

  it.each([
    undefined,
    '',
    'not-a-token',
    '00000000-0000-0000-0000-000000000000.short',
  ])('rejects malformed token %s', (token) => {
    expect(parseRefreshSessionId(token)).toBeNull();
  });
});
