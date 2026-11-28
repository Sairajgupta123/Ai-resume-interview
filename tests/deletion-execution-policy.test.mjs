import test from "node:test";
import assert from "node:assert/strict";
import { DELETION_EXECUTION_LEASE_MS, isSupportedDeletionRecordingPath, canClaimDeletionExecution, isDeletionExecutionLeaseExpired, anonymizedDeletionTombstone } from "../lib/deletion-execution-policy.mjs";

test("accepts only app-owned local and private S3 recording keys", () => {
  assert.equal(isSupportedDeletionRecordingPath("data/recordings/123e4567-e89b-12d3-a456-426614174000.webm"), true);
  assert.equal(isSupportedDeletionRecordingPath("s3://recordings/123e4567-e89b-12d3-a456-426614174000.mp4"), true);
  assert.equal(isSupportedDeletionRecordingPath("../../.env"), false);
  assert.equal(isSupportedDeletionRecordingPath("data/recordings/../../.env"), false);
  assert.equal(isSupportedDeletionRecordingPath("s3://other-bucket/secret.txt"), false);
  assert.equal(isSupportedDeletionRecordingPath("https://example.com/recording.mp4"), false);
  assert.equal(isSupportedDeletionRecordingPath(null), false);
});

test("only approved or failed requests can be claimed immediately", () => {
  assert.equal(canClaimDeletionExecution({ status: "approved_for_deletion" }), true);
  assert.equal(canClaimDeletionExecution({ status: "deletion_failed" }), true);
  assert.equal(canClaimDeletionExecution({ status: "pending_candidate_verification" }), false);
  assert.equal(canClaimDeletionExecution({ status: "verified_pending_approval" }), false);
});

test("in-progress requests can be retried only after the lease expires", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const recent = { status: "deletion_in_progress", executionStartedAt: new Date(now.getTime() - DELETION_EXECUTION_LEASE_MS + 1000) };
  const stale = { status: "deletion_in_progress", executionStartedAt: new Date(now.getTime() - DELETION_EXECUTION_LEASE_MS) };
  assert.equal(isDeletionExecutionLeaseExpired(recent, now), false);
  assert.equal(isDeletionExecutionLeaseExpired(stale, now), true);
  assert.equal(canClaimDeletionExecution(recent, now), false);
  assert.equal(canClaimDeletionExecution(stale, now), true);
  assert.equal(isDeletionExecutionLeaseExpired({ status: "deletion_in_progress", executionStartedAt: null }, now), false);
  assert.equal(isDeletionExecutionLeaseExpired({ status: "deletion_in_progress", executionStartedAt: "not-a-date" }, now), false);
  assert.equal(isDeletionExecutionLeaseExpired({ status: "approved_for_deletion", executionStartedAt: stale.executionStartedAt }, now), false);
  assert.equal(canClaimDeletionExecution({ status: "deletion_in_progress", executionStartedAt: null }, now), false);
});

test("tombstone clears candidate-identifying fields but preserves workflow identity", () => {
  assert.deepEqual(anonymizedDeletionTombstone("req_123"), {
    interviewId: "deleted:req_123",
    candidateNameSnapshot: "[deleted]",
    candidateEmailSnapshot: null,
    roleSnapshot: "[deleted]",
    reason: "Candidate data deletion completed.",
    verificationTokenHash: null,
    verificationExpiresAt: null,
    lastErrorCode: null
  });
});

test("recording recovery is blocked once deletion has atomically locked the interview", async () => {
  const { isInterviewDeletionLocked } = await import("../lib/deletion-execution-policy.mjs");
  assert.equal(isInterviewDeletionLocked({ status: "completed", recordingPath: null, deletionInProgress: false }), false);
  assert.equal(isInterviewDeletionLocked({ status: "completed", recordingPath: null, deletionInProgress: true }), true);
  assert.equal(isInterviewDeletionLocked(null), false);
});
