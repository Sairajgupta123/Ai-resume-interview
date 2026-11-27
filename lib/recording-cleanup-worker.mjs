import { randomUUID } from "node:crypto";
import {
  RECORDING_CLEANUP_BATCH_SIZE,
  RECORDING_CLEANUP_LEASE_MS,
  RECORDING_CLEANUP_MAX_ATTEMPTS,
  RECORDING_CLEANUP_REFERENCE_RECHECK_MS,
  recordingCleanupFailureCode,
  recordingCleanupRetryDelayMs
} from "./recording-cleanup-policy.mjs";

export async function processRecordingCleanupBatch({ db, deleteRecording, now = new Date() }) {
  const expiredLeaseBefore = new Date(now.getTime() - RECORDING_CLEANUP_LEASE_MS);
  const candidates = await db.recordingCleanupTask.findMany({
    where: {
      attempts: { lt: RECORDING_CLEANUP_MAX_ATTEMPTS },
      OR: [
        { status: { in: ["pending", "failed"] }, nextAttemptAt: { lte: now } },
        { status: "in_progress", leaseStartedAt: { lte: expiredLeaseBefore } }
      ]
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: RECORDING_CLEANUP_BATCH_SIZE
  });

  let completed = 0;
  let retried = 0;
  let skipped = 0;
  for (const task of candidates) {
    const leaseToken = randomUUID();
    const claim = await db.recordingCleanupTask.updateMany({
      where: {
        id: task.id,
        attempts: { lt: RECORDING_CLEANUP_MAX_ATTEMPTS },
        OR: [
          { status: { in: ["pending", "failed"] }, nextAttemptAt: { lte: now } },
          { status: "in_progress", leaseStartedAt: { lte: expiredLeaseBefore } }
        ]
      },
      data: {
        status: "in_progress",
        attempts: { increment: 1 },
        leaseStartedAt: now,
        leaseToken,
        lastErrorCode: null
      }
    });
    if (claim.count !== 1) {
      skipped += 1;
      continue;
    }

    try {
      // A cleanup task may have been created after an ambiguous database
      // commit. Recheck references immediately before deleting the object.
      const referenced = await db.interview.findFirst({
        where: { recordingPath: task.storedPath },
        select: { id: true }
      });
      if (referenced) {
        // Keep the unique-path task alive. The referenced recording may be
        // replaced later; marking this task completed would prevent the
        // replacement transaction from enqueueing the same path again.
        const deferred = await db.recordingCleanupTask.updateMany({
          where: { id: task.id, status: "in_progress", leaseToken },
          data: {
            status: "pending",
            attempts: task.attempts,
            nextAttemptAt: new Date(now.getTime() + RECORDING_CLEANUP_REFERENCE_RECHECK_MS),
            leaseStartedAt: null,
            leaseToken: null,
            lastErrorCode: "RECORDING_STILL_REFERENCED"
          }
        });
        if (deferred.count === 1) retried += 1;
        else skipped += 1;
        continue;
      }

      await deleteRecording(task.storedPath);
      const finalized = await db.recordingCleanupTask.updateMany({
        where: { id: task.id, status: "in_progress", leaseToken },
        data: { status: "completed", leaseStartedAt: null, leaseToken: null, lastErrorCode: null }
      });
      if (finalized.count === 1) completed += 1;
      else skipped += 1;
    } catch (error) {
      const attempts = task.attempts + 1;
      const retryAt = new Date(now.getTime() + recordingCleanupRetryDelayMs(attempts));
      const failed = await db.recordingCleanupTask.updateMany({
        where: { id: task.id, status: "in_progress", leaseToken },
        data: {
          status: "failed",
          leaseStartedAt: null,
          leaseToken: null,
          nextAttemptAt: retryAt,
          lastErrorCode: recordingCleanupFailureCode(error)
        }
      });
      if (failed.count === 1) retried += 1;
      else skipped += 1;
    }
  }

  return { ok: true, inspected: candidates.length, completed, retryScheduled: retried, skipped };
}
