import { HarnessError } from '@robbot/core';

export function mapUnknownError(error: unknown): HarnessError {
  if (error instanceof HarnessError) {
    return error;
  }

  if (error instanceof Error) {
    return new HarnessError(error.message, 'unknown', error);
  }

  return new HarnessError('Unknown DSH adapter error.', 'unknown', error);
}
