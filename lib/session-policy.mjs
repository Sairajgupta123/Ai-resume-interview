export function parseEmployerSessionToken(token) {
  if (typeof token !== "string" || !token) return null;
  // Usernames are configuration values and may themselves contain periods.
  // Parse the timestamp and signature from the right-hand side instead of
  // assuming the username is a single dot-free token.
  const signatureSeparator = token.lastIndexOf(".");
  if (signatureSeparator <= 0 || signatureSeparator === token.length - 1) return null;
  const timestampSeparator = token.lastIndexOf(".", signatureSeparator - 1);
  if (timestampSeparator <= 0 || timestampSeparator === signatureSeparator - 1) return null;
  return {
    username: token.slice(0, timestampSeparator),
    timestamp: token.slice(timestampSeparator + 1, signatureSeparator),
    signature: token.slice(signatureSeparator + 1)
  };
}

export const EMPLOYER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export function isSessionTimestampValid(timestamp, nowMs = Date.now(), maxAgeSeconds = EMPLOYER_SESSION_MAX_AGE_SECONDS) {
  if (typeof timestamp !== "string" || !/^\d+$/.test(timestamp)) return false;
  const issuedAtMs = Number(timestamp);
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) return false;
  const ageMs = nowMs - issuedAtMs;
  return ageMs >= 0 && ageMs < maxAgeSeconds * 1000;
}
