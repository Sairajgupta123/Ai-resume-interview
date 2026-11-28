import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { canClaimDeletionExecution, DELETION_EXECUTION_LEASE_MS } from "@/lib/deletion-execution-policy.mjs";
import { finalizeDeletionExecution, markDeletionExecutionFailed } from "@/lib/deletion-execution-service.mjs";
import { deleteStoredInterviewRecording } from "@/lib/deletion-storage.mjs";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  if (!(await isEmployerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await context.params;
  try {
    const requestRecord = await db.privacyDeletionRequest.findUnique({ where: { id } });
    if (!requestRecord) return NextResponse.json({ error: "Deletion request not found." }, { status: 404 });
    if (!canClaimDeletionExecution(requestRecord)) {
      return NextResponse.json({ error: "Candidate verification and employer approval are required, or another deletion worker currently holds the execution lease." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    const now = new Date();
    const leaseExpiredBefore = new Date(now.getTime() - DELETION_EXECUTION_LEASE_MS);
    const leaseToken = randomUUID();
    const claimed = await db.$transaction(async tx => {
      const claim = await tx.privacyDeletionRequest.updateMany({
        where: {
          id,
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
      if (claim.count !== 1) return false;

      // Lock recording recovery in the same transaction as the deletion lease.
      // An upload that committed first is visible to the read below; an upload
      // that commits later fails its deletionInProgress=false update predicate.
      const interview = await tx.interview.findUnique({
        where: { id: requestRecord.interviewId },
        select: { id: true, status: true, deletionInProgress: true }
      });
      if (interview) {
        if (interview.status !== "completed") throw new Error("DELETION_INTERVIEW_STATE_CHANGED");
        if (!interview.deletionInProgress) {
          const locked = await tx.interview.updateMany({
            where: { id: interview.id, status: "completed", deletionInProgress: false },
            data: { deletionInProgress: true }
          });
          if (locked.count !== 1) throw new Error("DELETION_INTERVIEW_LOCK_CONFLICT");
        }
      }
      return true;
    });
    if (!claimed) {
      return NextResponse.json({ error: "This request is already being processed or is not approved." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    try {
      const interview = await db.interview.findUnique({
        where: { id: requestRecord.interviewId },
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
  } catch (error) {
    if (error instanceof Error && (error.message === "DELETION_INTERVIEW_STATE_CHANGED" || error.message === "DELETION_INTERVIEW_LOCK_CONFLICT")) {
      return NextResponse.json({ error: "The interview changed while deletion was starting. Refresh and retry." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Could not execute the deletion request." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
