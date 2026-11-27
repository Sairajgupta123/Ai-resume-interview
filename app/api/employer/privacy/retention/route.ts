import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { buildRetentionPreviewFromCounts, parseRetentionDays } from "@/lib/retention-policy.mjs";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const configuredDays = process.env.INTERVIEW_RETENTION_DAYS;
    const days = parseRetentionDays(configuredDays);
    const now = new Date();
    const cutoff = days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const [totalInterviews, completedInterviews, inProgressInterviews, invitedInterviews, eligibleCompletedInterviews, consentedInterviews, missingConsentMetadata] = await Promise.all([
      db.interview.count(),
      db.interview.count({ where: { status: "completed" } }),
      db.interview.count({ where: { status: "in_progress" } }),
      db.interview.count({ where: { status: "invited" } }),
      cutoff ? db.interview.count({ where: { status: "completed", createdAt: { lt: cutoff } } }) : Promise.resolve(0),
      db.interview.count({ where: { consentAcceptedAt: { not: null }, consentVersion: { not: null } } }),
      db.interview.count({ where: { OR: [{ consentAcceptedAt: null }, { consentVersion: null }] } })
    ]);
    const preview = buildRetentionPreviewFromCounts({
      totalInterviews,
      completedInterviews,
      inProgressInterviews,
      invitedInterviews,
      eligibleCompletedInterviews,
      consentedInterviews,
      missingConsentMetadata
    }, configuredDays, now);
    return NextResponse.json(
      { preview },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Could not generate the retention preview." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
