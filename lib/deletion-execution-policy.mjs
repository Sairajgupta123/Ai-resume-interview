export const DELETION_EXECUTION_LEASE_MS = 5 * 60 * 1000;

const LOCAL_RECORDING_PATTERN = /^data\/recordings\/[a-f0-9-]{36}\.(webm|mp4|mov)$/i;
const REMOTE_RECORDING_PATTERN = /^s3:\/\/recordings\/[a-f0-9-]{36}\.(webm|mp4|mov)$/i;

export function isSupportedDeletionRecordingPath(value) {
  return typeof value === "string" && (LOCAL_RECORDING_PATTERN.test(value) || REMOTE_RECORDING_PATTERN.test(value));
}

export function isDeletionExecutionLeaseExpired(request, now = new Date()) {
  if (!request || request.status !== "deletion_in_progress" || !request.executionStartedAt) return false;
  const startedAt = new Date(request.executionStartedAt).getTime();
  return Number.isFinite(startedAt) && now.getTime() - startedAt >= DELETION_EXECUTION_LEASE_MS;
}

export function canClaimDeletionExecution(request, now = new Date()) {
  if (!request) return false;
  if (request.status === "approved_for_deletion" || request.status === "deletion_failed") return true;
  return isDeletionExecutionLeaseExpired(request, now);
}

export function anonymizedDeletionTombstone(requestId) {
  return {
    interviewId: "deleted:" + requestId,
    candidateNameSnapshot: "[deleted]",
    candidateEmailSnapshot: null,
    roleSnapshot: "[deleted]",
    reason: "Candidate data deletion completed.",
    verificationTokenHash: null,
    verificationExpiresAt: null,
    lastErrorCode: null
  };
}

export function isInterviewDeletionLocked(interview) {
  return Boolean(interview?.deletionInProgress);
}
