import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { buildEmployerAnalyticsFromAggregates, buildEmployerAnalyticsWeekWindows } from "@/lib/employer-analytics-policy.mjs";

export const runtime = "nodejs";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  try {
    const now = new Date();
    const windows = buildEmployerAnalyticsWeekWindows(now);
    const weeklyQueries = windows.map(async (window, index) => {
      const dateFilter = index === windows.length - 1
        ? { gte: window.start, lte: now }
        : { gte: window.start, lt: window.end };
      const [total, completed] = await Promise.all([
        db.interview.count({ where: { createdAt: dateFilter } }),
        db.interview.count({ where: { createdAt: dateFilter, status: "completed" } })
      ]);
      return { total, completed };
    });
    const [statusGroups, decisionGroups, roleGroups, completedReports, weeklyCounts] = await Promise.all([
      db.interview.groupBy({ by: ["status"], _count: { _all: true } }),
      db.interview.groupBy({ by: ["employerDecision"], _count: { _all: true } }),
      db.interview.groupBy({ by: ["role"], _count: { _all: true } }),
      db.interview.findMany({
        where: { status: "completed", reportJson: { not: null } },
        select: { reportJson: true }
      }),
      Promise.all(weeklyQueries)
    ]);
    const statusCounts = Object.fromEntries(statusGroups.map(row => [row.status, row._count._all]));
    const decisionCounts = Object.fromEntries(decisionGroups.map(row => [row.employerDecision ?? "pending", row._count._all]));
    const roleCounts = roleGroups.map(row => ({ role: row.role, count: row._count._all }));
    const analytics = buildEmployerAnalyticsFromAggregates({
      statusCounts, decisionCounts, roleCounts, weeklyCounts, completedReports
    }, now);
    return NextResponse.json({ analytics }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not load employer analytics." }, { status: 500, headers });
  }
}
