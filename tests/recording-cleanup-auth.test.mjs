import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedRecordingCleanupRequest } from "../lib/recording-cleanup-auth.mjs";

const secret = "a".repeat(48);
function request(authorization) {
  return { headers: { get: name => name.toLowerCase() === "authorization" ? authorization : null } };
}

test("accepts only the configured bearer secret", () => {
  assert.equal(isAuthorizedRecordingCleanupRequest(request("Bearer " + secret), secret), true);
});

test("rejects absent, short, malformed and incorrect secrets", () => {
  assert.equal(isAuthorizedRecordingCleanupRequest(request(null), secret), false);
  assert.equal(isAuthorizedRecordingCleanupRequest(request("Basic " + secret), secret), false);
  assert.equal(isAuthorizedRecordingCleanupRequest(request("Bearer " + "b".repeat(48)), secret), false);
  assert.equal(isAuthorizedRecordingCleanupRequest(request("Bearer short"), secret), false);
  assert.equal(isAuthorizedRecordingCleanupRequest(request("Bearer " + secret), undefined), false);
  assert.equal(isAuthorizedRecordingCleanupRequest(request("Bearer " + secret), "short"), false);
});
