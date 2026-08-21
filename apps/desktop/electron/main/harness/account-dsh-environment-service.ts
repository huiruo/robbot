import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { app } from 'electron';

import type { AccountRecord } from '../../storage/repositories';

export interface AccountAiRuntime {
  accountId: string;
  accountHash: string;
  provider: 'deepseek' | 'openai';
  dshProvider: 'deepseek-official' | 'openai';
  model?: string;
  key: string;
  apiUrl?: string;
  keyFingerprint: string;
  fingerprint: string;
}

export interface AccountDshEnvironment {
  accountHash: string;
  dshHome: string;
  partition: string;
  aiRuntime: AccountAiRuntime;
}

export class AccountDshEnvironmentService {
  resolve(account: AccountRecord): AccountDshEnvironment {
    const aiRuntime = aiRuntimeForAccount(account);
    if (!aiRuntime) {
      const provider = account.selectedAi === 'openai' ? 'OpenAI' : 'DeepSeek';
      throw new Error(`${provider} API key is missing. Please open Settings and save the key first.`);
    }

    const dshHome = path.join(app.getPath('userData'), 'dsh-home', 'accounts', aiRuntime.accountHash);
    const environment: AccountDshEnvironment = {
      accountHash: aiRuntime.accountHash,
      dshHome,
      partition: `persist:robbot-dsh-${aiRuntime.accountHash}`,
      aiRuntime: {
        ...aiRuntime,
        fingerprint: runtimeFingerprint({
          accountHash: aiRuntime.accountHash,
          provider: aiRuntime.provider,
          model: aiRuntime.model,
          apiUrl: aiRuntime.apiUrl,
          keyFingerprint: aiRuntime.keyFingerprint,
          dshHome,
        }),
      },
    };

    this.sync(environment);
    return environment;
  }

  private sync(environment: AccountDshEnvironment): void {
    fs.mkdirSync(environment.dshHome, { recursive: true });
    fs.mkdirSync(path.join(environment.dshHome, 'profiles', 'web'), { recursive: true });
    fs.writeFileSync(
      path.join(environment.dshHome, '.credentials.yaml'),
      credentialsYaml(environment.aiRuntime),
      { mode: 0o600 },
    );
  }
}

function aiRuntimeForAccount(account: AccountRecord): Omit<AccountAiRuntime, 'fingerprint'> | undefined {
  const provider = account.selectedAi === 'openai' ? 'openai' : 'deepseek';
  const raw = provider === 'openai' ? account.openai : account.deepseek;
  if (!raw) return undefined;

  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const key = typeof value.key === 'string' ? value.key.trim() : '';
    if (!key) return undefined;
    const model = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : undefined;
    const apiUrl = typeof value.apiUrl === 'string' && value.apiUrl.trim() ? value.apiUrl.trim() : undefined;
    const accountHash = hash(account.id, 16);
    return {
      accountId: account.id,
      accountHash,
      provider,
      dshProvider: provider === 'openai' ? 'openai' : 'deepseek-official',
      model,
      key,
      apiUrl,
      keyFingerprint: hash(key, 12),
    };
  } catch {
    return undefined;
  }
}

function runtimeFingerprint(input: {
  accountHash: string;
  provider: string;
  model?: string;
  apiUrl?: string;
  keyFingerprint: string;
  dshHome: string;
}): string {
  return hash(JSON.stringify(input), 32);
}

function credentialsYaml(aiRuntime: AccountAiRuntime): string {
  const entries: Record<string, string> = {};
  if (aiRuntime.provider === 'openai') {
    entries.OPENAI_API_KEY = aiRuntime.key;
  } else {
    entries.DEEPSEEK_API_KEY = aiRuntime.key;
  }
  return `${Object.entries(entries).map(([key, value]) => `${key}: ${yamlString(value)}`).join('\n')}\n`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function hash(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}
