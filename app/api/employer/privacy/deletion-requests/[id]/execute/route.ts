import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmployerAuthenticated } from "@/lib/auth";
import { canClaimDeletionExecution, anonymizedDeletionTombstone, DELETION_EXECUTION_LEASE_MS } from "@/lib/deletion-execution-policy.mjs";
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
    const claim = await db.privacyDeletionRequest.updateMany({
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
    if (claim.count !== 1) {
      return NextResponse.json({ error: "This request is already being processed or is not approved." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    try {
      const interview = await db.interview.findUnique({
        where: { id: requestRecord.interviewId },
        select: { id: true, recordingPath: true }
      });
      if (interview?.recordingPath) await deleteStoredInterviewRecording(interview.recordingPath);

      await db.$transaction(async tx => {
        const ownership = await tx.privacyDeletionRequest.updateMany({
          where: { id, status: "deletion_in_progress", executionLeaseToken: leaseToken },
          data: { executionStartedAt: new Date() }
        });
        if (ownership.count !== 1) throw new Error("DELETION_LEASE_LOST");

        await tx.interviewMessage.deleteMany({ where: { interviewId: requestRecord.interviewId } });
        await tx.interviewSignal.deleteMany({ where: { interviewId: requestRecord.interviewId } });
        await tx.employerDecisionHistory.deleteMany({ where: { interviewId: requestRecord.interviewId } });
        if (interview) await tx.interview.delete({ where: { id: requestRecord.interviewId } });

        await tx.privacyDeletionEvent.create({
          data: {
            requestId: id,
            action: "deletion_completed",
            actor: "employer",
            details: "Candidate interview data and associated recording were deleted after candidate verification and employer approval."
          }
        });
        await tx.privacyDeletionRequest.update({
          where: { id },
          data: {
            ...anonymizedDeletionTombstone(id),
            status: "deletion_completed",
            completedAt: new Date(),
            executionStartedAt: null,
            executionLeaseToken: null
          }
        });
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
      await db.$transaction(async tx => {
        const failed = await tx.privacyDeletionRequest.updateMany({
          where: { id, status: "deletion_in_progress", executionLeaseToken: leaseToken },
          data: { status: "deletion_failed", lastErrorCode: code, executionStartedAt: null, executionLeaseToken: null }
        });
        if (failed.count === 1) {
          await tx.privacyDeletionEvent.create({
            data: { requestId: id, action: "deletion_failed", actor: "system", details: "Deletion execution failed safely. Retry is available after the underlying issue is resolved." }
          });
        }
      });
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
