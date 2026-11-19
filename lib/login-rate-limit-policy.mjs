export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;

export function getLoginLimit(attempt, nowMs = Date.now()) {
  if (!attempt) return { limited: false, retryAfterSeconds: 0 };
  const blockedUntilMs = attempt.blockedUntil ? new Date(attempt.blockedUntil).getTime() : 0;
  if (blockedUntilMs > nowMs) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((blockedUntilMs - nowMs) / 1000))
    };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

export function isLoginWindowExpired(attempt, nowMs = Date.now()) {
  return Boolean(attempt) && nowMs - new Date(attempt.windowStartedAt).getTime() >= LOGIN_WINDOW_MS;
}

export function nextLoginAttempt(attempt, nowMs = Date.now()) {
  if (!attempt || isLoginWindowExpired(attempt, nowMs)) {
    return { attempts: 1, windowStartedAt: new Date(nowMs), blockedUntil: null };
  }
  const attempts = attempt.attempts + 1;
  return {
    attempts,
    windowStartedAt: new Date(attempt.windowStartedAt),
    blockedUntil: attempts >= LOGIN_MAX_ATTEMPTS ? new Date(nowMs + LOGIN_BLOCK_MS) : null
  };
}
