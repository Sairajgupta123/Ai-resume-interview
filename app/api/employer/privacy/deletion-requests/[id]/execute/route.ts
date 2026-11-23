import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEmployerOrganizationAccess } from "@/lib/auth";
import { canClaimDeletionExecution, DELETION_EXECUTION_LEASE_MS } from "@/lib/deletion-execution-policy.mjs";
import { finalizeDeletionExecution, markDeletionExecutionFailed } from "@/lib/deletion-execution-service.mjs";
import { deleteStoredInterviewRecording } from "@/lib/deletion-storage.mjs";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const access = await getEmployerOrganizationAccess("privacy:execute_deletion");
  if (!access) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await context.params;
  try {
    const requestRecord = await db.privacyDeletionRequest.findUnique({ where: { id } });
    if (!requestRecord) return NextResponse.json({ error: "Deletion request not found." }, { status: 404 });
    const ownedInterview = await db.interview.findFirst({ where: { id: requestRecord.interviewId, organizationId: access.organizationId }, select: { id: true } });
    if (!ownedInterview) return NextResponse.json({ error: "Deletion request not found." }, { status: 404 });
    if (!canClaimDeletionExecution(requestRecord)) {
      return NextResponse.json({ error: "Candidate verification and employer approval are required, or another deletion worker currently holds the execution lease." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    const now = new Date();
    const leaseExpiredBefore = new Date(now.getTime() - DELETION_EXECUTION_LEASE_MS);
    const leaseToken = randomUUID();
    const claim = await db.privacyDeletionRequest.updateMany({
      where: {
        id,
        interviewId: requestRecord.interviewId,
        // Keep candidate verification as an atomic database precondition, not only a pre-read check.
        verifiedAt: { not: null },
        OR: [
          { status: "approved_for_deletion" },
          { status: "deletion_failed" },
          { status: "deletion_in_progress", executionStartedAt: { lte: leaseExpiredBefore } }
        ]
      },
      data: {
        status: "deletion_in_progress",
        executionStartedAt: now,
        executionLeaseToken: leaseToken,
        deletionAttempts: { increment: 1 },
        lastErrorCode: null
      }
    });
    if (claim.count !== 1) {
      return NextResponse.json({ error: "This request is already being processed or is not approved." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    try {
      const interview = await db.interview.findFirst({
        where: { id: requestRecord.interviewId, organizationId: access.organizationId },
        select: { id: true, recordingPath: true }
      });
      if (interview?.recordingPath) await deleteStoredInterviewRecording(interview.recordingPath);

      await finalizeDeletionExecution(db, {
        requestId: id,
        interviewId: requestRecord.interviewId,
        leaseToken
      });

      return NextResponse.json({
        ok: true,
        status: "deletion_completed",
        message: "Candidate interview data and recording have been deleted. A minimal anonymized deletion receipt remains."
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof Error && error.message === "DELETION_LEASE_LOST") {
        return NextResponse.json({ error: "This worker no longer owns the deletion request. Another worker may have taken over; refresh the request status." }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }

      const code = error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED"
        ? "STORAGE_NOT_CONFIGURED"
        : error instanceof Error && error.message === "UNSUPPORTED_RECORDING_REFERENCE"
          ? "UNSUPPORTED_RECORDING_REFERENCE"
          : "DELETION_EXECUTION_FAILED";
      await markDeletionExecutionFailed(db, { requestId: id, leaseToken, errorCode: code });
      return NextResponse.json({
        error: code === "STORAGE_NOT_CONFIGURED"
          ? "Private recording storage is not configured. No database candidate data was deleted; configure storage and retry."
          : "Deletion could not be completed. The request is marked failed and can be retried safely after investigation."
      }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  } catch {
    return NextResponse.json({ error: "Could not execute the deletion request." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
