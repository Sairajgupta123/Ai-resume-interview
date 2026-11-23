import test from "node:test";
import assert from "node:assert/strict";
import {
  base64Pcm16ToFloat32,
  pcm16ToBase64,
  resampleFloat32ToPcm16
} from "../lib/grok-voice-audio.mjs";

test("resamples 48 kHz input to 24 kHz PCM16", () => {
  const input = new Float32Array([0, 0.5, -0.5, 1, -1, 0]);
  const output = resampleFloat32ToPcm16(input, 48000, 24000);
  assert.equal(output.length, 3);
  assert.deepEqual([...output], [0, -16384, -32768]);
});

test("converts normalized float samples to signed PCM16 safely", () => {
  const output = resampleFloat32ToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]), 24000);
  assert.deepEqual([...output], [-32768, -16384, 0, 16384, 32767]);
});

test("clamps samples outside the normalized audio range", () => {
  const output = resampleFloat32ToPcm16(new Float32Array([-2, 2]), 24000);
  assert.deepEqual([...output], [-32768, 32767]);
});

test("returns an empty output for empty input", () => {
  assert.equal(resampleFloat32ToPcm16(new Float32Array(0), 48000).length, 0);
});

test("rejects invalid sample rates", () => {
  assert.throws(() => resampleFloat32ToPcm16(new Float32Array([0]), 0), RangeError);
});

test("round-trips PCM16 samples through base64", () => {
  const input = new Int16Array([-32768, -16384, 0, 16384, 32767]);
  const encoded = pcm16ToBase64(input);
  const decoded = base64Pcm16ToFloat32(encoded);
  assert.equal(decoded.length, input.length);
  assert.deepEqual([...decoded], [-1, -0.5, 0, 0.5, 32767 / 32768]);
});

test("rejects malformed PCM16 base64 payloads", () => {
  assert.throws(() => base64Pcm16ToFloat32("AQ=="), RangeError);
});

test("rejects non-PCM16 values for base64 encoding", () => {
  assert.throws(() => pcm16ToBase64(new Uint8Array([0, 1])), TypeError);
});

test("rejects non-Float32 audio input", () => {
  assert.throws(() => resampleFloat32ToPcm16([0, 1], 24000), TypeError);
});

test("validates sample rates even when the input is empty", () => {
  assert.throws(() => resampleFloat32ToPcm16(new Float32Array(0), 0), RangeError);
});
