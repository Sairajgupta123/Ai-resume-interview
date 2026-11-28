import test from "node:test";
import assert from "node:assert/strict";
import { processRecordingCleanupBatch } from "../lib/recording-cleanup-worker.mjs";

test("timestamps each cleanup lease when its task is claimed, not at batch start", async () => {
  let clockMs = Date.parse("2026-11-28T10:00:00.000Z");
  const initial = new Date(clockMs);
  const tasks = ["first", "second"].map(id => ({
    id,
    storedPath: `s3://recordings/${id}`,
    status: "pending",
    attempts: 0,
    nextAttemptAt: initial,
    leaseStartedAt: null
  }));
  const claims = [];
  const db = {
    recordingCleanupTask: {
      findMany: async () => tasks,
      updateMany: async args => {
        if (args.data.status === "in_progress") claims.push({ id: args.where.id, leaseStartedAt: args.data.leaseStartedAt });
        return { count: 1 };
      }
    },
    interview: { findFirst: async () => null }
  };

  const result = await processRecordingCleanupBatch({
    db,
    now: initial,
    clock: () => new Date(clockMs),
    deleteRecording: async path => {
      if (path.endsWith("/first")) clockMs += 130_000;
    }
  });

  assert.equal(result.completed, 2);
  assert.equal(claims.length, 2);
  assert.equal(claims[0].leaseStartedAt.toISOString(), "2026-11-28T10:00:00.000Z");
  assert.equal(claims[1].leaseStartedAt.toISOString(), "2026-11-28T10:02:10.000Z");
});
