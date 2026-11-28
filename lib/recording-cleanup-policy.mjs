export const RECORDING_CLEANUP_LEASE_MS = 2 * 60 * 1000;
export const RECORDING_CLEANUP_BASE_RETRY_MS = 30 * 1000;
export const RECORDING_CLEANUP_MAX_RETRY_MS = 24 * 60 * 60 * 1000;
export const RECORDING_CLEANUP_MAX_ATTEMPTS = 12;
export const RECORDING_CLEANUP_BATCH_SIZE = 10;
export const RECORDING_CLEANUP_REFERENCE_RECHECK_MS = 5 * 60 * 1000;

export function canClaimRecordingCleanupTask(task, now = new Date()) {
  if (!task || task.status === "completed" || task.attempts >= RECORDING_CLEANUP_MAX_ATTEMPTS) return false;
  const nowMs = now.getTime();
  if (task.status === "pending" || task.status === "failed") {
    return new Date(task.nextAttemptAt).getTime() <= nowMs;
  }
  if (task.status === "in_progress" && task.leaseStartedAt) {
    return nowMs - new Date(task.leaseStartedAt).getTime() >= RECORDING_CLEANUP_LEASE_MS;
  }
  return false;
}

export function recordingCleanupRetryDelayMs(attempts) {
  const safeAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  return Math.min(
    RECORDING_CLEANUP_BASE_RETRY_MS * (2 ** Math.min(safeAttempts - 1, 20)),
    RECORDING_CLEANUP_MAX_RETRY_MS
  );
}

export function recordingCleanupFailureCode(error) {
  if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") return "STORAGE_NOT_CONFIGURED";
  if (error instanceof Error && error.message === "UNSUPPORTED_RECORDING_REFERENCE") return "UNSUPPORTED_RECORDING_REFERENCE";
  if (error instanceof Error && error.name === "TimeoutError") return "STORAGE_TIMEOUT";
  return "STORAGE_DELETE_FAILED";
}
