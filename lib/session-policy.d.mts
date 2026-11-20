export const EMPLOYER_SESSION_MAX_AGE_SECONDS: number;
export function isSessionTimestampValid(
  timestamp: string,
  nowMs?: number,
  maxAgeSeconds?: number
): boolean;
