import test from "node:test";
import assert from "node:assert/strict";
import { inspectCachedRecordingRows } from "../lib/recording-cache-policy.mjs";

const chunk = (index, mimeType = "video/webm") => ({
  index,
  mimeType,
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: mimeType })
});
const metadata = (status = "complete", mimeType = "video/webm") => ({
  recordType: "metadata",
  status,
  mimeType
});

test("returns null when no cached rows exist", () => {
  assert.equal(inspectCachedRecordingRows([]), null);
});

test("returns ordered chunks and completion metadata", () => {
  const result = inspectCachedRecordingRows([chunk(1), metadata(), chunk(0)]);
  assert.deepEqual(result.chunks.map(blob => blob.size), [3, 3]);
  assert.equal(result.mimeType, "video/webm");
  assert.equal(result.complete, true);
});

test("keeps interrupted recordings explicitly incomplete", () => {
  const result = inspectCachedRecordingRows([chunk(0), metadata("recording")]);
  assert.equal(result.complete, false);
});

test("rejects missing chunk indexes instead of concatenating an incomplete video", () => {
  assert.throws(
    () => inspectCachedRecordingRows([chunk(0), chunk(2), metadata()]),
    /incomplete or inconsistent/
  );
});

test("rejects mixed MIME types", () => {
  assert.throws(
    () => inspectCachedRecordingRows([chunk(0), chunk(1, "video/mp4"), metadata()]),
    /incomplete or inconsistent/
  );
});

test("rejects empty, malformed and non-Blob chunks", () => {
  assert.throws(() => inspectCachedRecordingRows([{ index: 0, mimeType: "video/webm", blob: new Blob([]) }, metadata()]));
  assert.throws(() => inspectCachedRecordingRows([{ index: 0, mimeType: "video/webm", blob: {} }, metadata()]));
  assert.throws(() => inspectCachedRecordingRows([{ index: 1, mimeType: "video/webm", blob: new Blob(["x"]) }, metadata()]));
});

test("rejects duplicate metadata records and metadata-only snapshots", () => {
  assert.throws(() => inspectCachedRecordingRows([metadata(), metadata(), chunk(0)]));
  assert.throws(() => inspectCachedRecordingRows([metadata()]));
});
