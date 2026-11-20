import { anonymizedDeletionTombstone } from "./deletion-execution-policy.mjs";

export async function finalizeDeletionExecution(db, { requestId, interviewId, leaseToken, now = new Date() }) {
  return db.$transaction(async tx => {
    const ownership = await tx.privacyDeletionRequest.updateMany({
      where: { id: requestId, interviewId, status: "deletion_in_progress", executionLeaseToken: leaseToken },
      data: { executionStartedAt: now }
    });
    if (ownership.count !== 1) throw new Error("DELETION_LEASE_LOST");

    await tx.interviewMessage.deleteMany({ where: { interviewId } });
    await tx.interviewSignal.deleteMany({ where: { interviewId } });
    await tx.employerDecisionHistory.deleteMany({ where: { interviewId } });
    await tx.interview.deleteMany({ where: { id: interviewId } });

    await tx.privacyDeletionEvent.create({
      data: {
        requestId,
        action: "deletion_completed",
        actor: "employer",
        details: "Candidate interview data and associated recording were deleted after candidate verification and employer approval."
      }
    });
    // Preserve event type, actor and timestamp, but never retain free-form text
    // that could contain candidate identifiers or interview content after deletion.
    await tx.privacyDeletionEvent.updateMany({
      where: { requestId },
      data: { details: "Workflow metadata retained for deletion accountability; candidate content is not retained." }
    });

    await tx.privacyDeletionRequest.update({
      where: { id: requestId },
      data: {
        ...anonymizedDeletionTombstone(requestId),
        status: "deletion_completed",
        completedAt: now,
        executionStartedAt: null,
        executionLeaseToken: null
      }
    });
  });
}

export async function markDeletionExecutionFailed(db, { requestId, leaseToken, errorCode }) {
  return db.$transaction(async tx => {
    const failed = await tx.privacyDeletionRequest.updateMany({
      where: { id: requestId, status: "deletion_in_progress", executionLeaseToken: leaseToken },
      data: {
        status: "deletion_failed",
        lastErrorCode: errorCode,
        executionStartedAt: null,
        executionLeaseToken: null
      }
    });
    if (failed.count !== 1) return false;

    await tx.privacyDeletionEvent.create({
      data: {
        requestId,
        action: "deletion_failed",
        actor: "system",
        details: "Deletion execution failed safely. Retry is available after the underlying issue is resolved."
      }
    });
    return true;
  });
}
