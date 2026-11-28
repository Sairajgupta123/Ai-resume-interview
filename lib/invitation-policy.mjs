export function isCandidateInvitationActive(token, expiresAt, status, nowMs = Date.now()) {
  if (typeof token !== "string" || token.length < 32 || token.length > 256) return false;
  if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) return false;
  if (!Number.isFinite(nowMs) || expiresAt.getTime() <= nowMs || !["invited", "in_progress"].includes(status)) return false;
  return true;
}

export function canExchangeCandidateInvitation(status, startedAt, expiresAt, nowMs = Date.now()) {
  return status === "invited"
    && startedAt === null
    && expiresAt instanceof Date
    && Number.isFinite(expiresAt.getTime())
    && Number.isFinite(nowMs)
    && expiresAt.getTime() > nowMs;
}
