import { ApiClient, ApiError } from './api';
import { initialAuthState, reduceAuthState, type AuthState } from './auth-state';
import type { LoginInput, RegisterInput } from './types';

const apiUrl = import.meta.env.MERMAID_API_URL ?? '';

class AuthController {
  current = $state<AuthState>(initialAuthState);
  private initialization: Promise<void> | null = null;

  readonly api = new ApiClient(apiUrl, fetch, (session) => {
    this.current = reduceAuthState(
      this.current,
      session ? { type: 'authenticated', user: session.user } : { type: 'anonymous' }
    );
  });

  initialize(): Promise<void> {
    this.initialization ??= this.api.refresh().then(
      () => undefined,
      (error: unknown) => {
        if (!(error instanceof ApiError && error.status === 401)) console.error(error);
      }
    );
    return this.initialization;
  }

  async login(input: LoginInput): Promise<void> {
    await this.api.login(input);
  }

  async register(input: RegisterInput): Promise<void> {
    await this.api.register(input);
  }

  async logout(): Promise<void> {
    await this.api.logout();
  }
}

export const auth = new AuthController();
