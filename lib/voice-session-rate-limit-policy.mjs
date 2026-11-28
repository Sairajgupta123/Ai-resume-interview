export const VOICE_SESSION_WINDOW_MS = 5 * 60 * 1000;
export const VOICE_SESSION_MAX_ATTEMPTS = 12;
export const VOICE_SESSION_BLOCK_MS = 5 * 60 * 1000;

export function isVoiceSessionWindowExpired(attempt, nowMs = Date.now()) {
  return Boolean(attempt) && nowMs - new Date(attempt.windowStartedAt).getTime() >= VOICE_SESSION_WINDOW_MS;
}

export function getVoiceSessionLimit(attempt, nowMs = Date.now()) {
  if (!attempt || isVoiceSessionWindowExpired(attempt, nowMs)) {
    return { limited: false, retryAfterSeconds: 0 };
  }
  const blockedUntilMs = attempt.blockedUntil ? new Date(attempt.blockedUntil).getTime() : 0;
  if (blockedUntilMs > nowMs) {
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntilMs - nowMs) / 1000)) };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

export function getVoiceSessionAttemptDecision(attempts) {
  return {
    limited: attempts > VOICE_SESSION_MAX_ATTEMPTS,
    shouldBlock: attempts >= VOICE_SESSION_MAX_ATTEMPTS
  };
}
