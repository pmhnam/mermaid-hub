import { argon2id, hash, verify } from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateRefreshToken(): { sessionId: string; token: string } {
  const sessionId = randomUUID();
  return {
    sessionId,
    token: `${sessionId}.${randomBytes(48).toString('base64url')}`,
  };
}

export function parseRefreshSessionId(token?: string): string | null {
  if (!token) return null;
  const separator = token.indexOf('.');
  const sessionId = separator > 0 ? token.slice(0, separator) : '';
  return UUID_PATTERN.test(sessionId) && token.length > separator + 32
    ? sessionId
    : null;
}

export function hashRefreshToken(token: string): Promise<string> {
  return hash(token, { type: argon2id });
}

export function verifyRefreshToken(
  hashValue: string,
  token: string,
): Promise<boolean> {
  return verify(hashValue, token);
}
