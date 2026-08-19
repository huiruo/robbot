import { DshRuntimeManager, type DshRuntimeStatus } from '@robbot/dsh-adapter';

export interface HarnessRuntimeStatus {
  status: DshRuntimeStatus;
  runtimeRoot: string;
}

export class HarnessService {
  private readonly runtimeManager = new DshRuntimeManager();

  getStatus(): HarnessRuntimeStatus {
    const runtime = this.runtimeManager.resolveRuntime();

    return {
      status: this.runtimeManager.status(),
      runtimeRoot: runtime.root,
    };
  }
}
