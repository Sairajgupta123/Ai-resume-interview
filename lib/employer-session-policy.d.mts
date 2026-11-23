export function isEmployerUserSessionPayload(
  payload: unknown,
  nowMs?: number,
  maxAgeSeconds?: number
): payload is { v: 2; sub: string; sv: number; iat: number };
