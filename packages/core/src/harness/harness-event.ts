import type { ApprovalRequest } from './approval.js';

export type HarnessEvent =
  | { type: 'run.started'; runId: string; sessionId: string }
  | { type: 'assistant.delta'; text: string }
  | { type: 'assistant.reasoning.delta'; text: string }
  | { type: 'assistant.message'; text: string }
  | { type: 'tool.started'; toolCallId: string; name: string; input?: unknown }
  | { type: 'tool.output'; toolCallId: string; output: string }
  | { type: 'approval.required'; approval: ApprovalRequest }
  | { type: 'tool.completed'; toolCallId: string; result?: unknown }
  | { type: 'runtime.activity' }
  | { type: 'run.completed'; runId: string }
  | { type: 'run.failed'; runId?: string; error: { message: string; code?: string } }
  | { type: 'run.interrupted'; runId?: string; error?: { message: string; code?: string } };
