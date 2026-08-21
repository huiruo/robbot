import fs from 'node:fs';
import path from 'node:path';
import { app, net, safeStorage } from 'electron';
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

export interface SavedLogin {
  email: string;
  password: string;
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

  constructor(private readonly accounts: AccountRepository) {
    this.current = this.restoreCurrentSession();
  }

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
    const current = this.getCurrentUser();
    if (current) {
      this.accounts.clearAuthSession(current.id);
    }
    this.current = null;
  }

  getSavedLogin(): SavedLogin | null {
    if (this.getCurrentUser()) {
      return null;
    }

    const account = this.accounts.getLatestSavedPasswordAccount();
    if (!account?.email || !account.savedPassword) {
      return null;
    }

    const password = decryptPassword(account.savedPassword);
    return password ? { email: account.email, password } : null;
  }

  private async authenticate(pathname: string, input: { email: string; password: string }): Promise<AuthUser> {
    const response = await remoteAuth(pathname, input);
    if (response.code !== 1 || !response.data?.token || !response.data?.exp || !response.data?.user?.id) {
      if (pathname === '/api/auth/login' && shouldClearSavedLogin(response)) {
        this.accounts.clearAuthSessionByEmail(input.email);
      }
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
    this.accounts.saveAuthSession(user.id, {
      token: response.data.token,
      exp: response.data.exp,
      savedPassword: encryptPassword(input.password),
    });

    return user;
  }

  private restoreCurrentSession(): CurrentAuthSession | null {
    const account = this.accounts.getLatestAuthSession();
    if (!account?.authToken || !account.authExp) {
      return null;
    }

    return {
      token: account.authToken,
      exp: account.authExp,
      user: {
        id: account.id,
        email: account.email ?? '',
        username: account.username ?? '',
        avatar: account.avatar,
      },
    };
  }
}

function shouldClearSavedLogin(response: AuthResult<AuthResponse>): boolean {
  return response.hasResponse !== false && /invalid email or password/i.test(response.msg);
}

function encryptPassword(password: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }

  return safeStorage.encryptString(password).toString('base64');
}

function decryptPassword(encrypted: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }

  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return null;
  }
}

async function remoteAuth(pathname: string, input: { email: string; password: string }): Promise<AuthResult<AuthResponse>> {
  const base = apiBaseUrl();
  try {
    const response = await net.fetch(`${base}${pathname.replace(/^\//, '')}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://trading-front.pages.dev',
      },
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
    ?? envFileValue('ROBBOT_API_URL')
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
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath;
  return [
    path.join(appPath, '.env'),
    path.join(appPath, 'renderer', '.env'),
    path.join(resourcesPath, '.env'),
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
