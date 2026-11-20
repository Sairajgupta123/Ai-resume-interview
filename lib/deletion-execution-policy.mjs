export const DELETION_EXECUTION_LEASE_MS = 5 * 60 * 1000;

const LOCAL_RECORDING_PATTERN = /^data\/recordings\/[a-f0-9-]{36}\.(webm|mp4|mov)$/i;
const REMOTE_RECORDING_PATTERN = /^s3:\/\/recordings\/[a-f0-9-]{36}\.(webm|mp4|mov)$/i;

export function isSupportedDeletionRecordingPath(value) {
  return typeof value === "string" && (LOCAL_RECORDING_PATTERN.test(value) || REMOTE_RECORDING_PATTERN.test(value));
}

export function canClaimDeletionExecution(request, now = new Date()) {
  if (!request) return false;
  if (request.status === "approved_for_deletion" || request.status === "deletion_failed") return true;
  if (request.status !== "deletion_in_progress" || !request.executionStartedAt) return false;
  return now.getTime() - new Date(request.executionStartedAt).getTime() >= DELETION_EXECUTION_LEASE_MS;
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
