export const EMPLOYER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export function isSessionTimestampValid(timestamp, nowMs = Date.now(), maxAgeSeconds = EMPLOYER_SESSION_MAX_AGE_SECONDS) {
  if (typeof timestamp !== "string" || !/^\\d+$/.test(timestamp)) return false;
  const issuedAtMs = Number(timestamp);
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) return false;
  const ageMs = nowMs - issuedAtMs;
  return ageMs >= 0 && ageMs < maxAgeSeconds * 1000;
}
