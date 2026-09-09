export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface SessionMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}
