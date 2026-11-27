export const RECORDING_CLEANUP_LEASE_MS: number;
export const RECORDING_CLEANUP_BASE_RETRY_MS: number;
export const RECORDING_CLEANUP_MAX_RETRY_MS: number;
export const RECORDING_CLEANUP_MAX_ATTEMPTS: number;
export const RECORDING_CLEANUP_BATCH_SIZE: number;
export function canClaimRecordingCleanupTask(task: { status: string; attempts: number; nextAttemptAt?: Date | string; leaseStartedAt?: Date | string | null } | null | undefined, now?: Date): boolean;
export function recordingCleanupRetryDelayMs(attempts: number): number;
export function recordingCleanupFailureCode(error: unknown): string;
