export type EmployerAnalytics = {
  total: number;
  completed: number;
  completionRate: number;
  invited: number;
  inProgress: number;
  averageScore: number | null;
  scoredCount: number;
  decisions: { shortlist: number; review: number; reject: number; pending: number };
  scoreBands: Array<{ label: string; min: number; max: number; count: number }>;
  roles: Array<{ role: string; count: number; share: number }>;
  weeklyTrend: Array<{ weekStart: string; label: string; total: number; completed: number }>;
};
export function buildEmployerAnalytics(records: Array<{ status: string; overallScore: number | null; role: string; employerDecision: string | null; createdAt: Date | string; reportJson: string | null }>, now?: Date): EmployerAnalytics;
export function buildEmployerAnalyticsWeekWindows(now?: Date): Array<{ start: Date; end: Date }>;
export function buildEmployerAnalyticsFromAggregates(aggregates: {
  statusCounts: Record<string, number>;
  decisionCounts: Record<string, number>;
  roleCounts: Array<{ role: string; count: number }>;
  weeklyCounts: Array<{ total: number; completed: number }>;
  completedReports?: Array<{ reportJson: string | null }>;
  completedReportSummary?: { scoredCount: number; scoreTotal: number; scoreBands: number[] };
}, now?: Date): EmployerAnalytics;
export function summarizeEmployerAnalyticsReports(reports: Array<{ reportJson: string | null }>): { scoredCount: number; scoreTotal: number; scoreBands: number[] };
