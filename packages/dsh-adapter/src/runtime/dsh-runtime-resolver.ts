import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { defaultDshRuntimeConfig, type DshRuntimeConfig } from './runtime-config.js';

export interface ResolvedDshRuntime {
  root: string;
  config: DshRuntimeConfig;
}

export class DshRuntimeResolver {
  constructor(
    private readonly appRoot = findRobbotRoot(process.cwd()),
    private readonly config: DshRuntimeConfig = loadRuntimeConfig(appRoot),
  ) {}

  resolveRuntime(): ResolvedDshRuntime {
    return {
      root: path.resolve(this.appRoot, this.config.submodule),
      config: this.config,
    };
  }

  isRuntimeCheckoutPresent(): boolean {
    const runtime = this.resolveRuntime();
    return existsSync(path.join(runtime.root, 'package.json')) && existsSync(path.join(runtime.root, '.git'));
  }

  isRuntimeInstalled(): boolean {
    return existsSync(path.join(this.resolveRuntime().root, 'node_modules'));
  }
}

function loadRuntimeConfig(appRoot: string): DshRuntimeConfig {
  const configPath = path.join(appRoot, 'config/dsh-runtime.json');
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<DshRuntimeConfig>;
    return { ...defaultDshRuntimeConfig, ...parsed };
  } catch {
    return defaultDshRuntimeConfig;
  }
}

function findRobbotRoot(start: string): string {
  let current = path.resolve(start);

  while (true) {
    if (existsSync(path.join(current, 'config/dsh-runtime.json'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(start);
    }
    current = parent;
  }
}
