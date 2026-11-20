export function isCandidateInvitationActive(
  token: unknown,
  expiresAt: Date | null | undefined,
  status: string | null | undefined,
  nowMs = Date.now()
): boolean {
  if (typeof token !== "string" || token.length < 32 || token.length > 256) return false;
  if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) return false;
  if (expiresAt.getTime() <= nowMs || status === "completed") return false;
  return true;
}

export function canExchangeCandidateInvitation(
  status: string,
  startedAt: Date | null,
  expiresAt: Date | null,
  nowMs = Date.now()
): boolean {
  return status === "invited"
    && startedAt === null
    && expiresAt instanceof Date
    && Number.isFinite(expiresAt.getTime())
    && expiresAt.getTime() > nowMs;
}
