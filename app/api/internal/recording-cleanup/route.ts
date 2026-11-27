import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteStoredInterviewRecording } from "@/lib/deletion-storage.mjs";
import {
  RECORDING_CLEANUP_BATCH_SIZE,
  RECORDING_CLEANUP_LEASE_MS,
  RECORDING_CLEANUP_MAX_ATTEMPTS,
  recordingCleanupFailureCode,
  recordingCleanupRetryDelayMs
} from "@/lib/recording-cleanup-policy.mjs";

export const runtime = "nodejs";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const now = new Date();
  const expiredLeaseBefore = new Date(now.getTime() - RECORDING_CLEANUP_LEASE_MS);
  try {
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
          const finalized = await db.recordingCleanupTask.updateMany({
            where: { id: task.id, status: "in_progress", leaseToken },
            data: { status: "completed", leaseStartedAt: null, leaseToken: null, lastErrorCode: null }
          });
          if (finalized.count === 1) completed += 1;
          else skipped += 1;
          continue;
        }

        await deleteStoredInterviewRecording(task.storedPath);
        const finalized = await db.recordingCleanupTask.updateMany({
          where: { id: task.id, status: "in_progress", leaseToken },
          data: { status: "completed", leaseStartedAt: null, leaseToken: null, lastErrorCode: null }
        });
        if (finalized.count === 1) completed += 1;
        else skipped += 1;
      } catch (error) {
        const attempts = task.attempts + 1;
        const retryAt = new Date(Date.now() + recordingCleanupRetryDelayMs(attempts));
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

    return NextResponse.json({
      ok: true,
      inspected: candidates.length,
      completed,
      retryScheduled: retried,
      skipped
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Recording cleanup worker is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "30" }
    });
  }
}
