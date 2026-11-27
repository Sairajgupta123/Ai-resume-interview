import test from "node:test";
import assert from "node:assert/strict";
import { buildRetentionPreview, parseRetentionDays } from "../lib/retention-policy.mjs";

const now = new Date("2026-11-20T12:00:00.000Z");
const records = [
  { status: "completed", createdAt: "2025-11-19T11:59:59.000Z", consentAcceptedAt: now, consentVersion: "v1" },
  { status: "completed", createdAt: "2025-11-20T12:00:00.000Z", consentAcceptedAt: now, consentVersion: "v1" },
  { status: "in_progress", createdAt: "2025-01-01T00:00:00.000Z", consentAcceptedAt: null, consentVersion: null },
  { status: "invited", createdAt: "2025-01-01T00:00:00.000Z", consentAcceptedAt: null, consentVersion: null },
  { status: "completed", createdAt: "2025-01-01T00:00:00.000Z", consentAcceptedAt: null, consentVersion: "v1" }
];

test("accepts only whole retention days from one through ten years", () => {
  assert.equal(parseRetentionDays("365"), 365);
  assert.equal(parseRetentionDays(""), null);
  assert.equal(parseRetentionDays("0"), null);
  assert.equal(parseRetentionDays("365.5"), null);
  assert.equal(parseRetentionDays("3651"), null);
  assert.equal(parseRetentionDays("abc"), null);
});

test("preview includes only completed records older than the cutoff", () => {
  const result = buildRetentionPreview(records, "365", now);
  assert.equal(result.eligibleCompletedInterviews, 2);
  assert.equal(result.completedInterviews, 3);
  assert.equal(result.inProgressInterviews, 1);
  assert.equal(result.invitedInterviews, 1);
});

test("never includes in-progress interviews in retention eligibility", () => {
  const result = buildRetentionPreview(records, "365", now);
  assert.equal(result.eligibleCompletedInterviews, 2);
});

test("reports missing consent metadata without treating it as consent", () => {
  const result = buildRetentionPreview(records, "365", now);
  assert.equal(result.consentedInterviews, 2);
  assert.equal(result.missingConsentMetadata, 3);
});

test("disables retention preview when no valid policy is configured", () => {
  const result = buildRetentionPreview(records, undefined, now);
  assert.equal(result.configured, false);
  assert.equal(result.eligibleCompletedInterviews, 0);
  assert.equal(result.cutoff, null);
  assert.equal(result.deletionEnabled, false);
});

test("rejects invalid preview dates", () => {
  assert.throws(() => buildRetentionPreview(records, "365", new Date("invalid")));
});

import { buildRetentionPreviewFromCounts } from "../lib/retention-policy.mjs";

test("builds the same preview from database aggregate counts", () => {
  const counts = {
    totalInterviews: 5,
    completedInterviews: 3,
    inProgressInterviews: 1,
    invitedInterviews: 1,
    eligibleCompletedInterviews: 2,
    consentedInterviews: 2,
    missingConsentMetadata: 3
  };
  const fromCounts = buildRetentionPreviewFromCounts(counts, "365", now);
  const fromRows = buildRetentionPreview(records, "365", now);
  assert.deepEqual(fromCounts, fromRows);
});

test("rejects invalid aggregate counts instead of returning misleading metrics", () => {
  assert.throws(() => buildRetentionPreviewFromCounts({
    totalInterviews: -1,
    completedInterviews: 0,
    inProgressInterviews: 0,
    eligibleCompletedInterviews: 0,
    consentedInterviews: 0,
    missingConsentMetadata: 0
  }, "365", now));
});
