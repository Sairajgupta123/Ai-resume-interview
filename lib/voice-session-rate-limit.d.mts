export interface VoiceSessionRateLimitRecord {
  attempts: number;
  windowStartedAt: Date | string;
  blockedUntil?: Date | string | null;
}
export const VOICE_SESSION_WINDOW_MS: number;
export const VOICE_SESSION_MAX_MINTS: number;
export const VOICE_SESSION_BLOCK_MS: number;
export type VoiceSessionRateLimit =
  | { limited: true; retryAfterSeconds: number; resetWindow: false; attempts?: number }
  | { limited: false; attempts: number; windowStartedAt: Date; resetWindow: boolean };
export function getVoiceSessionRateLimit(
  attempt: VoiceSessionRateLimitRecord | null | undefined,
  nowMs?: number
): VoiceSessionRateLimit;
