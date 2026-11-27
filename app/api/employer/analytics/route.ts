import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { buildEmployerAnalytics } from "@/lib/employer-analytics-policy.mjs";

export const runtime = "nodejs";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  try {
    // Keep the wide dashboard scan lightweight: large report JSON blobs are only
    // fetched for completed interviews, because unfinished sessions cannot score.
    const [interviews, completedReports] = await Promise.all([
      db.interview.findMany({
        select: {
          id: true,
          status: true,
          role: true,
          employerDecision: true,
          createdAt: true
        }
      }),
      db.interview.findMany({
        where: { status: "completed", reportJson: { not: null } },
        select: { id: true, reportJson: true }
      })
    ]);
    const reportById = new Map(completedReports.map(row => [row.id, row.reportJson]));
    const analyticsRows = interviews.map(row => ({
      ...row,
      overallScore: null,
      reportJson: reportById.get(row.id) ?? null
    }));
    return NextResponse.json({ analytics: buildEmployerAnalytics(analyticsRows) }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not load employer analytics." }, { status: 500, headers });
  }
}
