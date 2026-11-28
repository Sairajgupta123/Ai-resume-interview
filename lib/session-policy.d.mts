export const EMPLOYER_SESSION_MAX_AGE_SECONDS: number;
export function isSessionTimestampValid(
  timestamp: string,
  nowMs?: number,
  maxAgeSeconds?: number
): boolean;
export function parseEmployerSessionToken(token: string): {
  username: string;
  timestamp: string;
  signature: string;
} | null;
