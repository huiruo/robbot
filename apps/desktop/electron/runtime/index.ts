import { HarnessService } from '../main/harness/harness-service';

export interface RuntimeServices {
  harness: HarnessService;
}

export function initializeRuntime(): RuntimeServices {
  return {
    harness: new HarnessService(),
  };
}
