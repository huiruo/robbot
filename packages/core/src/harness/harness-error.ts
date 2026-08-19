export type HarnessErrorCode =
  | 'runtime_not_found'
  | 'runtime_not_ready'
  | 'transport_error'
  | 'protocol_error'
  | 'run_interrupted'
  | 'unknown';

export class HarnessError extends Error {
  constructor(
    message: string,
    readonly code: HarnessErrorCode = 'unknown',
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HarnessError';
  }
}
