export function isEmployerUserSessionPayload(payload, nowMs = Date.now(), maxAgeSeconds = 60 * 60 * 12) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const value = payload;
  if (value.v !== 2 || typeof value.sub !== "string" || value.sub.length === 0 || value.sub.length > 128) return false;
  if (!Number.isSafeInteger(value.sv) || value.sv < 0) return false;
  if (!Number.isSafeInteger(value.iat) || value.iat <= 0) return false;
  const ageMs = nowMs - value.iat;
  return ageMs >= 0 && ageMs < maxAgeSeconds * 1000;
}
