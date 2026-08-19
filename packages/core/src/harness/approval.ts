export interface ApprovalInput {
  approvalId: string;
  approved: boolean;
  reason?: string;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}
