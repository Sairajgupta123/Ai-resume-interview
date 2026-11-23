import test from "node:test";
import assert from "node:assert/strict";
import { parseByteRange, validateRecordingStorageResponse } from "../lib/recording-range.mjs";

test("parses a bounded byte range", () => {
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { ok: true, start: 10, end: 19, length: 10 });
});

test("parses an open-ended range", () => {
  assert.deepEqual(parseByteRange("bytes=90-", 100), { ok: true, start: 90, end: 99, length: 10 });
});

test("parses a suffix range", () => {
  assert.deepEqual(parseByteRange("bytes=-10", 100), { ok: true, start: 90, end: 99, length: 10 });
});

test("clamps an end beyond the file size", () => {
  assert.deepEqual(parseByteRange("bytes=90-120", 100), { ok: true, start: 90, end: 99, length: 10 });
});

test("rejects unsatisfiable and malformed ranges", () => {
  for (const header of ["bytes=100-110", "bytes=20-10", "bytes=-0", "bytes=abc", "bytes=1-2,4-5", "items=1-2"]) {
    assert.deepEqual(parseByteRange(header, 100), { ok: false, status: 416 });
  }
});

test("rejects ranges for empty files", () => {
  assert.deepEqual(parseByteRange("bytes=0-0", 0), { ok: false, status: 416 });
});

test("rejects unsafe sizes", () => {
  assert.deepEqual(parseByteRange("bytes=0-1", Number.MAX_SAFE_INTEGER + 1), { ok: false, status: 416 });
});

test("accepts a remote full-file response with the exact content length", () => {
  assert.equal(validateRecordingStorageResponse({
    status: 200, contentRange: null, contentLength: "100"
  }, { size: 100, partial: false, start: 0, end: 99 }), true);
});

test("accepts a remote partial response only when range and length match", () => {
  assert.equal(validateRecordingStorageResponse({
    status: 206, contentRange: "bytes 10-19/100", contentLength: "10"
  }, { size: 100, partial: true, start: 10, end: 19 }), true);
});

test("rejects a remote partial response with a wrong content range", () => {
  assert.equal(validateRecordingStorageResponse({
    status: 206, contentRange: "bytes 0-9/100", contentLength: "10"
  }, { size: 100, partial: true, start: 10, end: 19 }), false);
});

test("rejects a remote partial response with a wrong content length", () => {
  assert.equal(validateRecordingStorageResponse({
    status: 206, contentRange: "bytes 10-19/100", contentLength: "9"
  }, { size: 100, partial: true, start: 10, end: 19 }), false);
});

test("rejects unexpected partial or malformed full-file responses", () => {
  assert.equal(validateRecordingStorageResponse({
    status: 206, contentRange: "bytes 0-99/100", contentLength: "100"
  }, { size: 100, partial: false, start: 0, end: 99 }), false);
  assert.equal(validateRecordingStorageResponse({
    status: 200, contentRange: null, contentLength: "99"
  }, { size: 100, partial: false, start: 0, end: 99 }), false);
});

test("rejects missing, non-decimal, and unsafe storage response lengths", () => {
  for (const contentLength of [null, "", "-1", "1e2", "9007199254740992"]) {
    assert.equal(validateRecordingStorageResponse({
      status: 200, contentRange: null, contentLength
    }, { size: 0, partial: false, start: 0, end: -1 }), false);
  }
  assert.equal(validateRecordingStorageResponse({
    status: 206, contentRange: "bytes 10-19/100", contentLength: null
  }, { size: 100, partial: true, start: 10, end: 19 }), false);
});

test("rejects invalid expected partial ranges", () => {
  assert.equal(validateRecordingStorageResponse({
    status: 206, contentRange: "bytes 10-19/100", contentLength: "10"
  }, { size: 100, partial: true, start: 10, end: 100 }), false);
});
