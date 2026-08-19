import type { HarnessEvent } from '@robbot/core';

export function mapAcpEventToHarnessEvent(_event: unknown): HarnessEvent {
  return {
    type: 'run.failed',
    error: {
      code: 'not_implemented',
      message: 'ACP event mapping is not implemented yet.',
    },
  };
}
