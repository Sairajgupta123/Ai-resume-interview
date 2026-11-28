import test from "node:test";
import assert from "node:assert/strict";
import { commitRecordingReplacement } from "../lib/recording-replacement.mjs";

test("successful replacement commits new reference then removes previous file", async () => {
  const calls = [];
  const result = await commitRecordingReplacement({
    commit: async () => { calls.push("commit"); return { count: 1 }; },
    cleanupNew: async () => calls.push("cleanup-new"),
    cleanupPrevious: async path => calls.push("cleanup-" + path),
    previousPath: "old-recording.webm"
  });
  assert.deepEqual(result, { ok: true, conflict: false });
  assert.deepEqual(calls, ["commit", "cleanup-old-recording.webm"]);
});

test("database commit failure triggers cleanup when no reference check is configured", async () => {
  const calls = [];
  await assert.rejects(() => commitRecordingReplacement({
    commit: async () => { calls.push("commit"); throw new Error("database unavailable"); },
    cleanupNew: async () => calls.push("cleanup-new"),
    cleanupPrevious: async () => calls.push("cleanup-old"),
    previousPath: "old-recording.webm"
  }), /database unavailable/);
  assert.deepEqual(calls, ["commit", "cleanup-new"]);
});

test("ambiguous database failure preserves new file when follow-up read finds its reference", async () => {
  const calls = [];
  await assert.rejects(() => commitRecordingReplacement({
    commit: async () => { throw new Error("connection lost after commit"); },
    isNewRecordingReferenced: async () => { calls.push("check-reference"); return true; },
    cleanupNew: async () => calls.push("cleanup-new"),
    cleanupPrevious: async () => calls.push("cleanup-old"),
    previousPath: "old-recording.webm"
  }), /connection lost after commit/);
  assert.deepEqual(calls, ["check-reference"]);
});

test("ambiguous database failure preserves new file when reference check is unavailable", async () => {
  const errors = [];
  const calls = [];
  await assert.rejects(() => commitRecordingReplacement({
    commit: async () => { throw new Error("database unavailable"); },
    isNewRecordingReferenced: async () => { throw new Error("read unavailable"); },
    cleanupNew: async () => calls.push("cleanup-new"),
    cleanupPrevious: async () => calls.push("cleanup-old"),
    onCleanupError: (error, stage) => errors.push([error.message, stage])
  }), /database unavailable/);
  assert.deepEqual(calls, []);
  assert.deepEqual(errors, [["read unavailable", "new-recording-reference-check-after-commit-error"]]);
});

test("concurrent update conflict cleans up new file and does not delete old file", async () => {
  const calls = [];
  const result = await commitRecordingReplacement({
    commit: async () => ({ count: 0 }),
    cleanupNew: async () => calls.push("cleanup-new"),
    cleanupPrevious: async () => calls.push("cleanup-old"),
    previousPath: "old-recording.webm"
  });
  assert.deepEqual(result, { ok: false, conflict: true });
  assert.deepEqual(calls, ["cleanup-new"]);
});

test("old file cleanup failure does not undo successful replacement", async () => {
  const errors = [];
  const result = await commitRecordingReplacement({
    commit: async () => ({ count: 1 }),
    cleanupNew: async () => assert.fail("new file must be retained"),
    cleanupPrevious: async () => { throw new Error("storage unavailable"); },
    previousPath: "old-recording.webm",
    onCleanupError: (error, stage) => errors.push([error.message, stage])
  });
  assert.deepEqual(result, { ok: true, conflict: false });
  assert.deepEqual(errors, [["storage unavailable", "previous-recording-after-replacement"]]);
});

test("cleanup failure after database failure is reported without hiding original error", async () => {
  const errors = [];
  await assert.rejects(() => commitRecordingReplacement({
    commit: async () => { throw new Error("database error"); },
    cleanupNew: async () => { throw new Error("cleanup error"); },
    cleanupPrevious: async () => {},
    onCleanupError: (error, stage) => errors.push([error.message, stage])
  }), /database error/);
  assert.deepEqual(errors, [["cleanup error", "new-recording-after-commit-error"]]);
});

test("cleanup error reporter throwing cannot break a successful replacement", async () => {
  const result = await commitRecordingReplacement({
    commit: async () => ({ count: 1 }),
    cleanupNew: async () => assert.fail("new file must be retained"),
    cleanupPrevious: async () => { throw new Error("storage unavailable"); },
    previousPath: "old-recording.webm",
    onCleanupError: () => { throw new Error("logger unavailable"); }
  });
  assert.deepEqual(result, { ok: true, conflict: false });
});

test("cleanup error reporter throwing cannot hide the original database error", async () => {
  await assert.rejects(() => commitRecordingReplacement({
    commit: async () => { throw new Error("database error"); },
    cleanupNew: async () => { throw new Error("cleanup error"); },
    cleanupPrevious: async () => {},
    onCleanupError: () => { throw new Error("logger unavailable"); }
  }), /database error/);
});

test("failed conflict cleanup is persisted for retry with the exact uploaded path", async () => {
  const calls = [];
  const result = await commitRecordingReplacement({
    commit: async () => ({ count: 0 }),
    cleanupNew: async () => { throw new Error("storage unavailable"); },
    cleanupNewPath: "s3://recordings/123e4567-e89b-12d3-a456-426614174000.webm",
    enqueueCleanup: async (storedPath, reason) => calls.push([storedPath, reason]),
    cleanupPrevious: async () => {},
    onCleanupError: () => {}
  });
  assert.deepEqual(result, { ok: false, conflict: true });
  assert.deepEqual(calls, [[
    "s3://recordings/123e4567-e89b-12d3-a456-426614174000.webm",
    "new-recording-after-conflict"
  ]]);
});

test("ambiguous commit reference-check failure enqueues a task that will recheck before deletion", async () => {
  const calls = [];
  await assert.rejects(() => commitRecordingReplacement({
    commit: async () => { throw new Error("database response lost"); },
    isNewRecordingReferenced: async () => { throw new Error("database read unavailable"); },
    cleanupNew: async () => assert.fail("must preserve object until reference can be checked"),
    cleanupNewPath: "data/recordings/123e4567-e89b-12d3-a456-426614174000.webm",
    enqueueCleanup: async (storedPath, reason) => calls.push([storedPath, reason]),
    cleanupPrevious: async () => {}
  }), /database response lost/);
  assert.deepEqual(calls, [[
    "data/recordings/123e4567-e89b-12d3-a456-426614174000.webm",
    "new-recording-after-commit-reference-check-failed"
  ]]);
});

test("ambiguous commit with a negative immediate reference read queues delayed cleanup without deleting", async () => {
  const calls = [];
  await assert.rejects(() => commitRecordingReplacement({
    commit: async () => { throw new Error("database error"); },
    isNewRecordingReferenced: async () => false,
    cleanupNew: async () => assert.fail("must not delete immediately after an ambiguous commit"),
    cleanupNewPath: "data/recordings/123e4567-e89b-12d3-a456-426614174000.webm",
    enqueueCleanup: async (storedPath, reason) => calls.push([storedPath, reason]),
    cleanupPrevious: async () => {}
  }), /database error/);
  assert.deepEqual(calls, [[
    "data/recordings/123e4567-e89b-12d3-a456-426614174000.webm",
    "new-recording-after-commit-ambiguous"
  ]]);
});
