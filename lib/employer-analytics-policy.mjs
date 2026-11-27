import { isRestorableInterviewReport } from "./report-recovery-policy.mjs";

const VALID_DECISIONS = ["shortlist", "review", "reject"];

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function percent(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function buildEmployerAnalyticsWeekWindows(now = new Date()) {
  const current = validDate(now) || new Date();
  const weekStart = new Date(current);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  weekStart.setDate(weekStart.getDate() - 5 * 7);
  return Array.from({ length: 6 }, (_, index) => {
    const start = new Date(weekStart);
    start.setDate(start.getDate() + index * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  });
}

function getScoredReports(reports) {
  return (Array.isArray(reports) ? reports : []).flatMap(row => {
    let report = null;
    if (typeof row.reportJson === "string") {
      try { report = JSON.parse(row.reportJson); } catch { return []; }
    }
    if (!isRestorableInterviewReport(report)) return [];
    return [{ overallScore: report.overallScore }];
  });
}

function finishAnalytics({ total, completed, invited, inProgress, decisions, roleCounts, weeklyTrend, reports }) {
  const scored = getScoredReports(reports);
  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, row) => sum + row.overallScore, 0) / scored.length)
    : null;
  const scoreBands = [
    { label: "80–100", min: 80, max: 100, count: 0 },
    { label: "60–79", min: 60, max: 79, count: 0 },
    { label: "0–59", min: 0, max: 59, count: 0 }
  ];
  for (const row of scored) {
    const band = scoreBands.find(item => row.overallScore >= item.min && row.overallScore <= item.max);
    if (band) band.count += 1;
  }
  const roleMap = new Map();
  for (const item of Array.isArray(roleCounts) ? roleCounts : []) {
    const role = typeof item.role === "string" && item.role.trim() ? item.role.trim() : "Unspecified role";
    roleMap.set(role, (roleMap.get(role) || 0) + item.count);
  }
  const roles = [...roleMap.entries()]
    .map(([role, count]) => ({ role, count, share: percent(count, total) }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role))
    .slice(0, 5);
  return {
    total,
    completed,
    completionRate: percent(completed, total),
    invited,
    inProgress,
    averageScore,
    scoredCount: scored.length,
    decisions,
    scoreBands,
    roles,
    weeklyTrend
  };
}

export function buildEmployerAnalyticsFromAggregates(aggregates, now = new Date()) {
  const statusCounts = aggregates?.statusCounts || {};
  const decisionCounts = aggregates?.decisionCounts || {};
  const total = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const completed = statusCounts.completed || 0;
  const invited = statusCounts.invited || 0;
  const inProgress = (statusCounts.in_progress || 0) + (statusCounts["in-progress"] || 0) + (statusCounts.started || 0);
  const decisions = {
    shortlist: decisionCounts.shortlist || 0,
    review: decisionCounts.review || 0,
    reject: decisionCounts.reject || 0,
    pending: total - (decisionCounts.shortlist || 0) - (decisionCounts.review || 0) - (decisionCounts.reject || 0)
  };
  const windows = buildEmployerAnalyticsWeekWindows(now);
  const weeklyCounts = Array.isArray(aggregates?.weeklyCounts) ? aggregates.weeklyCounts : [];
  const weeklyTrend = windows.map((window, index) => ({
    weekStart: window.start.toISOString(),
    label: window.start.toLocaleDateString("en", { month: "short", day: "numeric" }),
    total: weeklyCounts[index]?.total || 0,
    completed: weeklyCounts[index]?.completed || 0
  }));
  return finishAnalytics({
    total, completed, invited, inProgress, decisions,
    roleCounts: aggregates?.roleCounts,
    weeklyTrend,
    reports: aggregates?.completedReports
  });
}

export function buildEmployerAnalytics(records, now = new Date()) {
  const rows = Array.isArray(records) ? records : [];
  const statusCounts = {};
  const decisionCounts = {};
  const roleMap = new Map();
  for (const row of rows) {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    decisionCounts[row.employerDecision] = (decisionCounts[row.employerDecision] || 0) + 1;
    const role = typeof row.role === "string" && row.role.trim() ? row.role.trim() : "Unspecified role";
    roleMap.set(role, (roleMap.get(role) || 0) + 1);
  }
  const windows = buildEmployerAnalyticsWeekWindows(now);
  const weeklyCounts = windows.map(window => {
    const matches = rows.filter(row => {
      const createdAt = validDate(row.createdAt);
      return createdAt && createdAt >= window.start && createdAt <= validDate(now) && createdAt < window.end;
    });
    return { total: matches.length, completed: matches.filter(row => row.status === "completed").length };
  });
  const reports = rows.filter(row => row.status === "completed" && row.reportJson !== null).map(row => ({ reportJson: row.reportJson }));
  return buildEmployerAnalyticsFromAggregates({
    statusCounts,
    decisionCounts: {
      shortlist: decisionCounts.shortlist || 0,
      review: decisionCounts.review || 0,
      reject: decisionCounts.reject || 0
    },
    roleCounts: [...roleMap.entries()].map(([role, count]) => ({ role, count })),
    weeklyCounts,
    completedReports: reports
  }, now);
}
