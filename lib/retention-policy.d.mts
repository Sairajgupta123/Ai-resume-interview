export type RetentionPreview = {
  configured: boolean;
  retentionDays: number | null;
  cutoff: string | null;
  totalInterviews: number;
  completedInterviews: number;
  inProgressInterviews: number;
  invitedInterviews: number;
  eligibleCompletedInterviews: number;
  consentedInterviews: number;
  missingConsentMetadata: number;
  deletionEnabled: false;
};
export function parseRetentionDays(value: unknown): number | null;
export function buildRetentionPreview(records: Array<{ status: string; createdAt: Date | string; consentAcceptedAt: Date | string | null; consentVersion: string | null }>, configuredDays: unknown, now?: Date): RetentionPreview;

export function buildRetentionPreviewFromCounts(counts: {
  totalInterviews: number;
  completedInterviews: number;
  inProgressInterviews: number;
  invitedInterviews: number;
  eligibleCompletedInterviews: number;
  consentedInterviews: number;
  missingConsentMetadata: number;
}, configuredDays: unknown, now?: Date): RetentionPreview;
