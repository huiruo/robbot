import { existsSync } from 'node:fs';
import path from 'node:path';

import { defaultDshRuntimeConfig, type DshRuntimeConfig } from './runtime-config.js';

export interface ResolvedDshRuntime {
  root: string;
  config: DshRuntimeConfig;
}

export class DshRuntimeResolver {
  constructor(
    private readonly appRoot = findRobbotRoot(process.cwd()),
    private readonly config: DshRuntimeConfig = defaultDshRuntimeConfig,
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
