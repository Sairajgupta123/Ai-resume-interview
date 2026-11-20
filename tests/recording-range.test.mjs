import test from "node:test";
import assert from "node:assert/strict";
import { parseByteRange } from "../lib/recording-range.mjs";

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
