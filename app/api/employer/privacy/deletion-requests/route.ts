import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEmployerOrganizationAccess } from "@/lib/auth";
import { isDeletionExecutionLeaseExpired } from "@/lib/deletion-execution-policy.mjs";

export const runtime = "nodejs";

export async function GET() {
  const access = await getEmployerOrganizationAccess("privacy:manage_requests");
  if (!access) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const ownedInterviews = await db.interview.findMany({ where: { organizationId: access.organizationId }, select: { id: true } });
    const requests = await db.privacyDeletionRequest.findMany({
      where: { interviewId: { in: ownedInterviews.map(interview => interview.id) } },
      take: 100,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        interviewId: true,
        candidateNameSnapshot: true,
        candidateEmailSnapshot: true,
        roleSnapshot: true,
        reason: true,
        status: true,
        requestedBy: true,
        createdAt: true,
        updatedAt: true,
        deletionAttempts: true,
        lastErrorCode: true,
        executionStartedAt: true,
        completedAt: true,
        events: { orderBy: { createdAt: "desc" }, take: 10 }
      }
    });
    const now = new Date();
    const requestsWithRecoveryState = requests.map(request => ({
      ...request,
      executionLeaseExpired: isDeletionExecutionLeaseExpired(request, now)
    }));
    return NextResponse.json({ requests: requestsWithRecoveryState }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load privacy deletion requests." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
