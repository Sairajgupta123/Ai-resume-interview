export const VOICE_SESSION_WINDOW_MS: number;
export const VOICE_SESSION_MAX_ATTEMPTS: number;
export const VOICE_SESSION_BLOCK_MS: number;
export function isVoiceSessionWindowExpired(attempt: { windowStartedAt: Date | string | number } | null | undefined, nowMs?: number): boolean;
export function getVoiceSessionLimit(attempt: { blockedUntil?: Date | string | number | null } | null | undefined, nowMs?: number): { limited: boolean; retryAfterSeconds: number };
export function getVoiceSessionAttemptDecision(attempts: number): { limited: boolean; shouldBlock: boolean };
