export interface LoginAttemptPolicyRecord {
  attempts: number;
  windowStartedAt: Date | string;
  blockedUntil?: Date | string | null;
}
export const LOGIN_WINDOW_MS: number;
export const LOGIN_MAX_ATTEMPTS: number;
export const LOGIN_BLOCK_MS: number;
export const LOGIN_ATTEMPT_RETENTION_MS: number;
export function getLoginLimit(attempt: LoginAttemptPolicyRecord | null | undefined, nowMs?: number): { limited: boolean; retryAfterSeconds: number };
export function isLoginWindowExpired(attempt: LoginAttemptPolicyRecord | null | undefined, nowMs?: number): boolean;
export function nextLoginAttempt(attempt: LoginAttemptPolicyRecord | null | undefined, nowMs?: number): { attempts: number; windowStartedAt: Date; blockedUntil: Date | null };
export function isLoginAttemptGarbageCollectable(attempt: LoginAttemptPolicyRecord | null | undefined, nowMs?: number, retentionMs?: number): boolean;
