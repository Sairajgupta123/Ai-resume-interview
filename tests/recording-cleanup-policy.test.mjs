import test from "node:test";
import assert from "node:assert/strict";
import {
  canClaimRecordingCleanupTask,
  recordingCleanupRetryDelayMs,
  recordingCleanupFailureCode,
  RECORDING_CLEANUP_BASE_RETRY_MS,
  RECORDING_CLEANUP_LEASE_MS,
  RECORDING_CLEANUP_MAX_RETRY_MS,
  RECORDING_CLEANUP_MAX_ATTEMPTS
} from "../lib/recording-cleanup-policy.mjs";

const now = new Date("2026-11-27T10:00:00.000Z");

test("claims pending and failed cleanup tasks only when their retry time is due", () => {
  assert.equal(canClaimRecordingCleanupTask({ status: "pending", attempts: 0, nextAttemptAt: now }, now), true);
  assert.equal(canClaimRecordingCleanupTask({ status: "failed", attempts: 2, nextAttemptAt: new Date(now.getTime() + 1) }, now), false);
  assert.equal(canClaimRecordingCleanupTask({ status: "failed", attempts: 2, nextAttemptAt: now }, now), true);
});

test("reclaims expired worker leases but not active or completed tasks", () => {
  assert.equal(canClaimRecordingCleanupTask({
    status: "in_progress", attempts: 1, leaseStartedAt: new Date(now.getTime() - RECORDING_CLEANUP_LEASE_MS)
  }, now), true);
  assert.equal(canClaimRecordingCleanupTask({
    status: "in_progress", attempts: 1, leaseStartedAt: new Date(now.getTime() - RECORDING_CLEANUP_LEASE_MS + 1)
  }, now), false);
  assert.equal(canClaimRecordingCleanupTask({ status: "completed", attempts: 1, nextAttemptAt: now }, now), false);
});

test("stops retrying after the bounded attempt budget", () => {
  assert.equal(canClaimRecordingCleanupTask({ status: "failed", attempts: RECORDING_CLEANUP_MAX_ATTEMPTS, nextAttemptAt: now }, now), false);
});

test("uses capped exponential retry delays", () => {
  assert.equal(recordingCleanupRetryDelayMs(1), RECORDING_CLEANUP_BASE_RETRY_MS);
  assert.equal(recordingCleanupRetryDelayMs(2), RECORDING_CLEANUP_BASE_RETRY_MS * 2);
  assert.equal(recordingCleanupRetryDelayMs(99), RECORDING_CLEANUP_MAX_RETRY_MS);
  assert.ok(recordingCleanupRetryDelayMs(99) <= RECORDING_CLEANUP_MAX_RETRY_MS);
});

test("maps storage failures to bounded non-sensitive error codes", () => {
  assert.equal(recordingCleanupFailureCode(new Error("STORAGE_NOT_CONFIGURED")), "STORAGE_NOT_CONFIGURED");
  assert.equal(recordingCleanupFailureCode(new Error("UNSUPPORTED_RECORDING_REFERENCE")), "UNSUPPORTED_RECORDING_REFERENCE");
  const timeout = new Error("private endpoint details");
  timeout.name = "TimeoutError";
  assert.equal(recordingCleanupFailureCode(timeout), "STORAGE_TIMEOUT");
  assert.equal(recordingCleanupFailureCode(new Error("secret response body")), "STORAGE_DELETE_FAILED");
});
