import { isRestorableInterviewReport } from "./report-recovery-policy.mjs";

const VALID_DECISIONS = ["shortlist", "review", "reject"];

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function percent(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function buildEmployerAnalytics(records, now = new Date()) {
  const rows = Array.isArray(records) ? records : [];
  const total = rows.length;
  const completed = rows.filter(row => row.status === "completed");
  const invited = rows.filter(row => row.status === "invited");
  const inProgress = rows.filter(row => row.status === "in_progress" || row.status === "in-progress" || row.status === "started");
  // Analytics uses the same validated report as candidate/employer views and CSV.
  // A stale score column or malformed saved report must not affect aggregates.
  const scored = completed.flatMap(row => {
    let report = null;
    if (typeof row.reportJson === "string") {
      try { report = JSON.parse(row.reportJson); } catch { return []; }
    }
    if (!isRestorableInterviewReport(report)) return [];
    return [{ ...row, overallScore: report.overallScore }];
  });
  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, row) => sum + row.overallScore, 0) / scored.length)
    : null;

  const decisions = {
    shortlist: rows.filter(row => row.employerDecision === "shortlist").length,
    review: rows.filter(row => row.employerDecision === "review").length,
    reject: rows.filter(row => row.employerDecision === "reject").length,
    pending: rows.filter(row => !VALID_DECISIONS.includes(row.employerDecision)).length
  };

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
  for (const row of rows) {
    const role = typeof row.role === "string" && row.role.trim() ? row.role.trim() : "Unspecified role";
    roleMap.set(role, (roleMap.get(role) || 0) + 1);
  }
  const roles = [...roleMap.entries()]
    .map(([role, count]) => ({ role, count, share: percent(count, total) }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role))
    .slice(0, 5);

  const current = validDate(now) || new Date();
  const weekStart = new Date(current);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  weekStart.setDate(weekStart.getDate() - 5 * 7);
  const weeklyTrend = Array.from({ length: 6 }, (_, index) => {
    const start = new Date(weekStart);
    start.setDate(start.getDate() + index * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return {
      weekStart: start.toISOString(),
      label: start.toLocaleDateString("en", { month: "short", day: "numeric" }),
      total: 0,
      completed: 0
    };
  });
  for (const row of rows) {
    const createdAt = validDate(row.createdAt);
    if (!createdAt) continue;
    const bucket = weeklyTrend.find((week, index) => {
      const start = new Date(week.weekStart);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return createdAt >= start && (createdAt < end || (index === 5 && createdAt <= current));
    });
    if (bucket) {
      bucket.total += 1;
      if (row.status === "completed") bucket.completed += 1;
    }
  }

  return {
    total,
    completed: completed.length,
    completionRate: percent(completed.length, total),
    invited: invited.length,
    inProgress: inProgress.length,
    averageScore,
    scoredCount: scored.length,
    decisions,
    scoreBands,
    roles,
    weeklyTrend
  };
}
