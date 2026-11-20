export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

export function parseRetentionDays(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_RETENTION_DAYS || parsed > MAX_RETENTION_DAYS) return null;
  return parsed;
}

export function buildRetentionPreview(records, configuredDays, now = new Date()) {
  const days = parseRetentionDays(configuredDays);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) throw new Error("A valid preview date is required.");
  const cutoff = days === null ? null : new Date(current.getTime() - days * 24 * 60 * 60 * 1000);
  const rows = Array.isArray(records) ? records : [];
  const eligible = cutoff
    ? rows.filter(row => row.status === "completed" && row.createdAt && new Date(row.createdAt).getTime() <= cutoff.getTime())
    : [];
  const consented = rows.filter(row => Boolean(row.consentAcceptedAt && row.consentVersion)).length;
  const missingConsentMetadata = rows.filter(row => !row.consentAcceptedAt || !row.consentVersion).length;
  return {
    configured: days !== null,
    retentionDays: days,
    cutoff: cutoff ? cutoff.toISOString() : null,
    totalInterviews: rows.length,
    completedInterviews: rows.filter(row => row.status === "completed").length,
    inProgressInterviews: rows.filter(row => row.status !== "completed").length,
    eligibleCompletedInterviews: eligible.length,
    consentedInterviews: consented,
    missingConsentMetadata,
    deletionEnabled: false
  };
}
