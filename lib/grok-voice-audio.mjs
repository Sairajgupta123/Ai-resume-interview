/**
 * PCM helpers for xAI's Realtime Speech-to-Speech API.
 * The API expects signed 16-bit little-endian PCM at the configured rate.
 */

export function resampleFloat32ToPcm16(samples, inputRate, outputRate = 24000) {
  if (!(samples instanceof Float32Array)) {
    throw new TypeError("Audio samples must be a Float32Array.");
  }
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate) || inputRate <= 0 || outputRate <= 0) {
    throw new RangeError("Sample rates must be positive finite numbers.");
  }
  if (samples.length === 0) return new Int16Array(0);

  const outputLength = Math.max(1, Math.floor(samples.length * outputRate / inputRate));
  const output = new Int16Array(outputLength);
  const ratio = inputRate / outputRate;

  for (let i = 0; i < outputLength; i += 1) {
    const sourcePosition = i * ratio;
    const leftIndex = Math.min(Math.floor(sourcePosition), samples.length - 1);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const fraction = sourcePosition - leftIndex;
    const sample = samples[leftIndex] + (samples[rightIndex] - samples[leftIndex]) * fraction;
    const clamped = Math.max(-1, Math.min(1, sample));
    output[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }

  return output;
}

export function pcm16ToBase64(samples) {
  if (!(samples instanceof Int16Array)) {
    throw new TypeError("PCM samples must be an Int16Array.");
  }

  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64Pcm16ToFloat32(base64) {
  if (typeof base64 !== "string") {
    throw new TypeError("Audio delta must be a base64 string.");
  }
  const binary = atob(base64);
  if (binary.length % 2 !== 0) {
    throw new RangeError("PCM16 audio payload must contain complete 16-bit samples.");
  }
  const samples = new Float32Array(binary.length / 2);
  for (let i = 0; i < samples.length; i += 1) {
    const value = (binary.charCodeAt(i * 2) & 0xff) | ((binary.charCodeAt(i * 2 + 1) & 0xff) << 8);
    const signed = value >= 0x8000 ? value - 0x10000 : value;
    samples[i] = signed / 32768;
  }
  return samples;
}
