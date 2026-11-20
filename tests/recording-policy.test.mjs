import test from "node:test";
import assert from "node:assert/strict";
import { ACCEPTED_RECORDING_TYPES, MAX_RECORDING_BYTES, inspectRecordingUpload, isSafeRecordingFilename } from "../lib/recording-policy.mjs";

const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
const mp4 = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const uuid = "123e4567-e89b-12d3-a456-426614174000";

test("accepts a WebM payload with matching signature", () => {
  assert.deepEqual(inspectRecordingUpload("video/webm", webm.length, webm), { ok: true, extension: ".webm" });
});

test("accepts MP4 and QuickTime ISO-BMFF signatures", () => {
  assert.equal(inspectRecordingUpload("video/mp4", mp4.length, mp4).extension, ".mp4");
  assert.equal(inspectRecordingUpload("video/quicktime", mp4.length, mp4).extension, ".mov");
});

test("rejects unsupported MIME types", () => {
  assert.equal(inspectRecordingUpload("application/octet-stream", webm.length, webm).status, 415);
});

test("rejects mismatched MIME and file signatures", () => {
  assert.equal(inspectRecordingUpload("video/webm", mp4.length, mp4).status, 415);
  assert.equal(inspectRecordingUpload("video/mp4", webm.length, webm).status, 415);
});

test("rejects empty, oversized and unsafe sizes", () => {
  assert.equal(inspectRecordingUpload("video/webm", 0, webm).status, 413);
  assert.equal(inspectRecordingUpload("video/webm", MAX_RECORDING_BYTES + 1, webm).status, 413);
  assert.equal(inspectRecordingUpload("video/webm", Number.MAX_SAFE_INTEGER + 1, webm).status, 413);
});

test("rejects mismatched payload byte length", () => {
  assert.equal(inspectRecordingUpload("video/webm", webm.length + 1, webm).status, 400);
});

test("accepts only UUID-based recording filenames", () => {
  assert.equal(isSafeRecordingFilename(uuid + ".webm"), true);
  assert.equal(isSafeRecordingFilename("../" + uuid + ".webm"), false);
  assert.equal(isSafeRecordingFilename("recording.webm"), false);
});
