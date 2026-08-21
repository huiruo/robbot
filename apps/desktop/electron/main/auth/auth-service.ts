import fs from 'node:fs';
import path from 'node:path';
import type { AccountRecord, AccountRepository } from '../../storage/repositories';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  avatar?: string | null;
}

export interface AuthResponse {
  token: string;
  exp: number;
  user: AuthUser;
}

export interface AuthResult<T = unknown> {
  code: number;
  msg: string;
  data: T;
  errorCode?: string;
  hasResponse?: boolean;
}

interface CurrentAuthSession {
  token: string;
  exp: number;
  user: AuthUser;
}

export class AuthError extends Error {
  readonly code: 'UNAUTHENTICATED' | 'AUTH_FAILED';

  constructor(message: string, code: AuthError['code'] = 'UNAUTHENTICATED') {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export class AuthSessionService {
  private current: CurrentAuthSession | null = null;

  constructor(private readonly accounts: AccountRepository) {}

  getCurrentUser(): AuthUser | null {
    if (!this.current || Date.now() >= this.current.exp * 1000) {
      this.current = null;
      return null;
    }

    return this.current.user;
  }

  requireCurrentUser(): AuthUser {
    const user = this.getCurrentUser();
    if (!user) {
      throw new AuthError('Not authenticated.');
    }

    return user;
  }

  requireCurrentAccount(): AccountRecord {
    return this.accounts.get(this.requireCurrentUser().id);
  }

  async login(input: { email: string; password: string }): Promise<AuthUser> {
    return this.authenticate('/api/auth/login', input);
  }

  async register(input: { email: string; password: string }): Promise<AuthUser> {
    return this.authenticate('/api/auth/register', input);
  }

  logout(): void {
    this.current = null;
  }

  private async authenticate(pathname: string, input: { email: string; password: string }): Promise<AuthUser> {
    const response = await remoteAuth(pathname, input);
    if (response.code !== 1 || !response.data?.token || !response.data?.exp || !response.data?.user?.id) {
      throw new AuthError(response.msg || 'Authentication failed.', 'AUTH_FAILED');
    }

    const user = response.data.user;
    this.current = {
      token: response.data.token,
      exp: response.data.exp,
      user,
    };
    this.accounts.upsert({
      id: user.id,
      email: user.email,
      username: user.username,
      avatar: user.avatar,
    });

    return user;
  }
}

async function remoteAuth(pathname: string, input: { email: string; password: string }): Promise<AuthResult<AuthResponse>> {
  const base = apiBaseUrl();
  try {
    const response = await fetch(`${base}${pathname.replace(/^\//, '')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const payload = (await response.json().catch(() => null)) as AuthResult<AuthResponse> | null;
    return payload ?? {
      code: response.ok ? 1 : -1,
      msg: response.statusText || 'Request failed',
      data: null as unknown as AuthResponse,
      hasResponse: true,
    };
  } catch (cause) {
    return {
      code: -1,
      msg: cause instanceof Error ? cause.message : 'Request failed',
      data: null as unknown as AuthResponse,
      hasResponse: false,
    };
  }
}

function apiBaseUrl(): string {
  const configured = process.env.ROBBOT_API_URL
    ?? process.env.PUBLIC_API_URL
    ?? envFileValue('PUBLIC_API_URL')
    ?? 'http://localhost:3800';
  return `${configured.replace(/\/$/, '')}/`;
}

function envFileValue(name: string): string | undefined {
  for (const filename of envCandidates()) {
    const value = readEnvValue(filename, name);
    if (value) return value;
  }
  return undefined;
}

function envCandidates(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, 'renderer', '.env'),
    path.join(cwd, '.env'),
    path.resolve(cwd, '../../.env'),
  ];
}

function readEnvValue(filename: string, name: string): string | undefined {
  if (!fs.existsSync(filename)) return undefined;
  const prefix = `${name}=`;
  for (const line of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith(prefix)) continue;
    return unquote(trimmed.slice(prefix.length).trim());
  }
  return undefined;
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
