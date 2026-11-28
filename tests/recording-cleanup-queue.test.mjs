import test from "node:test";
import assert from "node:assert/strict";
import { enqueueRecordingCleanupTask } from "../lib/recording-cleanup-queue.mjs";

test("enqueues a pending cleanup task with a retry timestamp", async () => {
  const calls = [];
  const now = new Date("2026-11-27T10:00:00.000Z");
  const result = await enqueueRecordingCleanupTask({
    recordingCleanupTask: {
      create: async args => { calls.push(args); return { id: "task-1" }; }
    }
  }, {
    storedPath: "s3://recordings/123e4567-e89b-12d3-a456-426614174000.webm",
    reason: "recording_replaced",
    now
  });
  assert.equal(result, true);
  assert.deepEqual(calls, [{
    data: {
      storedPath: "s3://recordings/123e4567-e89b-12d3-a456-426614174000.webm",
      reason: "recording_replaced",
      status: "pending",
      nextAttemptAt: now
    }
  }]);
});

test("treats duplicate object paths as an idempotent enqueue", async () => {
  const result = await enqueueRecordingCleanupTask({
    recordingCleanupTask: {
      create: async () => { const error = new Error("duplicate"); error.code = "P2002"; throw error; }
    }
  }, { storedPath: "data/recordings/123e4567-e89b-12d3-a456-426614174000.webm", reason: "conflict" });
  assert.equal(result, false);
});

test("does not create an empty cleanup task", async () => {
  const result = await enqueueRecordingCleanupTask({
    recordingCleanupTask: { create: async () => assert.fail("must not create task") }
  }, { storedPath: "", reason: "empty" });
  assert.equal(result, false);
});
