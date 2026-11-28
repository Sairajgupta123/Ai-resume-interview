import test from "node:test";
import assert from "node:assert/strict";
import {
  isExpectedRecordingStorageResponse,
  parseRecordingContentLength
} from "../lib/recording-storage-response.mjs";

test("parses only explicit non-negative safe content lengths", () => {
  assert.equal(parseRecordingContentLength("0"), 0);
  assert.equal(parseRecordingContentLength("1048576"), 1048576);
  for (const value of [null, "", " 12", "-1", "+1", "1.5", "1e3", "9007199254740992"]) {
    assert.equal(parseRecordingContentLength(value), null);
  }
});

test("accepts a full-object response only with the exact status and length", () => {
  const expected = {
    status: 200,
    contentLength: "100",
    contentRange: null,
    expectedStatus: 200,
    expectedLength: 100
  };
  assert.equal(isExpectedRecordingStorageResponse(expected), true);
  assert.equal(isExpectedRecordingStorageResponse({ ...expected, status: 206 }), false);
  assert.equal(isExpectedRecordingStorageResponse({ ...expected, contentLength: "99" }), false);
  assert.equal(isExpectedRecordingStorageResponse({ ...expected, contentLength: null }), false);
  assert.equal(isExpectedRecordingStorageResponse({ ...expected, contentRange: "bytes 0-99/100" }), false);
});

test("accepts a byte-range response only when status, length and Content-Range match", () => {
  const expected = {
    status: 206,
    contentLength: "10",
    contentRange: "bytes 20-29/100",
    expectedStatus: 206,
    expectedLength: 10,
    expectedContentRange: "bytes 20-29/100"
  };
  assert.equal(isExpectedRecordingStorageResponse(expected), true);
  assert.equal(isExpectedRecordingStorageResponse({ ...expected, contentRange: "bytes 0-9/100" }), false);
  assert.equal(isExpectedRecordingStorageResponse({ ...expected, contentRange: "bytes 20-28/100" }), false);
  assert.equal(isExpectedRecordingStorageResponse({ ...expected, contentLength: "9" }), false);
  assert.equal(isExpectedRecordingStorageResponse({ ...expected, status: 200 }), false);
  assert.equal(isExpectedRecordingStorageResponse({ ...expected, contentRange: null }), false);
});

test("rejects a partial response when a full recording was requested", () => {
  assert.equal(isExpectedRecordingStorageResponse({
    status: 206,
    contentLength: "10",
    contentRange: "bytes 0-9/100",
    expectedStatus: 200,
    expectedLength: 100
  }), false);
});
