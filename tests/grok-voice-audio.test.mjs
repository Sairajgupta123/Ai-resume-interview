import test from "node:test";
import assert from "node:assert/strict";
import { resampleFloat32ToPcm16 } from "../lib/grok-voice-audio.mjs";

test("resamples 48 kHz input to 24 kHz PCM16", () => {
  const input = new Float32Array([0, 0.5, -0.5, 1, -1, 0]);
  const output = resampleFloat32ToPcm16(input, 48000, 24000);
  assert.equal(output.length, 3);
  assert.deepEqual([...output], [0, -16384, 0]);
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
