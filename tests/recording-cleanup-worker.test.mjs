import test from "node:test";
import assert from "node:assert/strict";
import { processRecordingCleanupBatch } from "../lib/recording-cleanup-worker.mjs";

const task = {
  id: "cleanup-1",
  storedPath: "s3://recordings/123e4567-e89b-12d3-a456-426614174000.webm",
  status: "pending",
  attempts: 0,
  nextAttemptAt: new Date("2026-11-27T10:00:00.000Z"),
  leaseStartedAt: null
};
function mockDb({ referenced = null, claimCount = 1, finalizeCount = 1, failureCount = 1 } = {}) {
  const updates = [];
  let updateCall = 0;
  return {
    updates,
    recordingCleanupTask: {
      findMany: async () => [task],
      updateMany: async args => {
        updates.push(args);
        updateCall += 1;
        if (updateCall === 1) return { count: claimCount };
        if (updateCall === 2 && args.data.status === "failed") return { count: failureCount };
        return { count: finalizeCount };
      }
    },
    interview: { findFirst: async () => referenced }
  };
}

test("deletes an unreferenced object and finalizes only the owned lease", async () => {
  const db = mockDb();
  const deleted = [];
  const result = await processRecordingCleanupBatch({
    db,
    deleteRecording: async path => deleted.push(path),
    now: new Date("2026-11-27T10:00:00.000Z")
  });
  assert.deepEqual(deleted, [task.storedPath]);
  assert.deepEqual(result, { ok: true, inspected: 1, completed: 1, retryScheduled: 0, skipped: 0 });
  assert.equal(db.updates[1].where.leaseToken, db.updates[0].data.leaseToken);
});

test("does not delete an object that is still referenced by an interview", async () => {
  const db = mockDb({ referenced: { id: "interview-1" } });
  let deleteCalls = 0;
  const result = await processRecordingCleanupBatch({
    db,
    deleteRecording: async () => { deleteCalls += 1; },
    now: new Date("2026-11-27T10:00:00.000Z")
  });
  assert.equal(deleteCalls, 0);
  assert.equal(result.completed, 1);
});

test("schedules retry with a bounded error code when storage deletion fails", async () => {
  const db = mockDb();
  const result = await processRecordingCleanupBatch({
    db,
    deleteRecording: async () => { throw new Error("secret endpoint response"); },
    now: new Date("2026-11-27T10:00:00.000Z")
  });
  assert.equal(result.retryScheduled, 1);
  assert.equal(db.updates[1].data.status, "failed");
  assert.equal(db.updates[1].data.lastErrorCode, "STORAGE_DELETE_FAILED");
  assert.ok(db.updates[1].data.nextAttemptAt instanceof Date);
  assert.equal(db.updates[1].data.nextAttemptAt.toISOString(), "2026-11-27T10:00:30.000Z");
});

test("does not delete when another worker already claimed the task", async () => {
  const db = mockDb({ claimCount: 0 });
  let deleteCalls = 0;
  const result = await processRecordingCleanupBatch({
    db,
    deleteRecording: async () => { deleteCalls += 1; },
    now: new Date("2026-11-27T10:00:00.000Z")
  });
  assert.equal(deleteCalls, 0);
  assert.equal(result.skipped, 1);
});
