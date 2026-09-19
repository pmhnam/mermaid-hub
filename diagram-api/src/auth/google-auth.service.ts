import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';

export interface GoogleIdentity {
  subject: string;
  email: string;
  displayName: string;
}

interface GoogleAttempt {
  purpose: string;
  state: string;
  nonce: string;
  verifier: string;
}

export const GOOGLE_ATTEMPT_COOKIE = 'google_login_attempt';
export const GOOGLE_COOKIE_PATH = '/api/auth/google';

@Injectable()
export class GoogleAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  get enabled(): boolean {
    return [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
      'APP_URL',
    ].every((name) => Boolean(this.config.get<string>(name)));
  }

  resultUrl(
    result: 'success' | 'failed' | 'cancelled' | 'account_exists',
  ): string {
    const url = new URL(
      `${this.config.getOrThrow<string>('APP_URL').replace(/\/$/, '')}/login`,
    );
    url.searchParams.set('google', result);
    return url.toString();
  }

  private client(): OAuth2Client {
    if (!this.enabled)
      throw new ServiceUnavailableException('Google sign-in is not configured');
    return new OAuth2Client({
      clientId: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: this.config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      redirectUri: this.config.getOrThrow<string>('GOOGLE_REDIRECT_URI'),
    });
  }

  async begin(): Promise<{ url: string; cookie: string }> {
    const client = this.client();
    const attempt: GoogleAttempt = {
      purpose: 'google-login',
      state: randomBytes(32).toString('base64url'),
      nonce: randomBytes(32).toString('base64url'),
      verifier: randomBytes(32).toString('base64url'),
    };
    const cookie = await this.jwt.signAsync(attempt, {
      expiresIn: '10m',
      audience: 'google-login',
    });
    const url = client.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge: createHash('sha256')
        .update(attempt.verifier)
        .digest('base64url'),
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: 'select_account',
    });
    return { url, cookie };
  }

  async complete(
    code: unknown,
    state: unknown,
    cookie: unknown,
  ): Promise<GoogleIdentity> {
    try {
      if (
        typeof code !== 'string' ||
        !code ||
        typeof state !== 'string' ||
        typeof cookie !== 'string'
      ) {
        throw new Error('Missing OAuth response');
      }
      const attempt = await this.jwt.verifyAsync<GoogleAttempt>(cookie, {
        audience: 'google-login',
      });
      if (
        attempt.purpose !== 'google-login' ||
        typeof attempt.state !== 'string' ||
        Buffer.byteLength(state) !== Buffer.byteLength(attempt.state) ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(attempt.state))
      ) {
        throw new Error('Invalid OAuth state');
      }
      const client = this.client();
      const { tokens } = await client.getToken({
        code,
        codeVerifier: attempt.verifier,
      });
      if (!tokens.id_token) throw new Error('Missing identity token');
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      });
      const payload = ticket.getPayload();
      const nonce = (payload as { nonce?: string } | undefined)?.nonce;
      if (
        !payload?.sub ||
        !payload.email ||
        payload.email_verified !== true ||
        nonce !== attempt.nonce
      ) {
        throw new Error('Unverified Google identity');
      }
      return {
        subject: payload.sub,
        email: payload.email.trim().toLowerCase(),
        displayName: (
          payload.name?.trim() || payload.email.split('@')[0]
        ).slice(0, 100),
      };
    } catch {
      throw new UnauthorizedException(
        'Google sign-in could not be verified. Please try again.',
      );
    }
  }
}
