export const DELETION_EXECUTION_LEASE_MS: number;
export function isSupportedDeletionRecordingPath(value: unknown): boolean;
export function isDeletionExecutionLeaseExpired(request: { status: string; executionStartedAt: Date | string | null } | null, now?: Date): boolean;
export function canClaimDeletionExecution(request: { status: string; executionStartedAt: Date | string | null } | null, now?: Date): boolean;
export function anonymizedDeletionTombstone(requestId: string): {
  interviewId: string;
  candidateNameSnapshot: string;
  candidateEmailSnapshot: null;
  roleSnapshot: string;
  reason: string;
  verificationTokenHash: null;
  verificationExpiresAt: null;
  lastErrorCode: null;
};
