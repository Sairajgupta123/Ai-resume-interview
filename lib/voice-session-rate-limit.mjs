export const VOICE_SESSION_WINDOW_MS = 15 * 60 * 1000;
export const VOICE_SESSION_MAX_MINTS = 8;
export const VOICE_SESSION_BLOCK_MS = 15 * 60 * 1000;

export function getVoiceSessionRateLimit(attempt, nowMs = Date.now()) {
  if (!Number.isFinite(nowMs)) throw new TypeError("A valid current timestamp is required.");

  if (attempt?.blockedUntil) {
    const blockedUntilMs = new Date(attempt.blockedUntil).getTime();
    if (Number.isFinite(blockedUntilMs) && blockedUntilMs > nowMs) {
      return {
        limited: true,
        retryAfterSeconds: Math.max(1, Math.ceil((blockedUntilMs - nowMs) / 1000)),
        resetWindow: false
      };
    }
  }

  if (!attempt) {
    return { limited: false, attempts: 1, windowStartedAt: new Date(nowMs), resetWindow: true };
  }

  const windowStartedAtMs = new Date(attempt.windowStartedAt).getTime();
  const blockedUntilMs = attempt.blockedUntil ? new Date(attempt.blockedUntil).getTime() : 0;
  const resetWindow = !Number.isFinite(windowStartedAtMs)
    || nowMs - windowStartedAtMs >= VOICE_SESSION_WINDOW_MS
    || (blockedUntilMs > 0 && blockedUntilMs <= nowMs);

  const attempts = resetWindow ? 1 : attempt.attempts + 1;
  if (attempts > VOICE_SESSION_MAX_MINTS) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAtMs + VOICE_SESSION_BLOCK_MS - nowMs) / 1000)),
      resetWindow: false,
      attempts
    };
  }

  return {
    limited: false,
    attempts,
    windowStartedAt: resetWindow ? new Date(nowMs) : new Date(windowStartedAtMs),
    resetWindow
  };
}
