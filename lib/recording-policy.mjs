export const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
export const ACCEPTED_RECORDING_TYPES = ["video/webm", "video/mp4", "video/quicktime"];

export function inspectRecordingUpload(mimeType, size, bytes) {
  if (!ACCEPTED_RECORDING_TYPES.includes(mimeType)) {
    return { ok: false, status: 415, error: "Only WebM, MP4, or QuickTime recordings are accepted." };
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_RECORDING_BYTES) {
    return { ok: false, status: 413, error: "Recording must be no larger than 100 MB." };
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size) {
    return { ok: false, status: 400, error: "Recording payload size is invalid." };
  }
  const isWebm = bytes.byteLength >= 4
    && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  const isIsoBmff = bytes.byteLength >= 12
    && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp";
  if ((mimeType === "video/webm" && !isWebm) || (mimeType !== "video/webm" && !isIsoBmff)) {
    return { ok: false, status: 415, error: "Recording file content does not match its declared video format." };
  }
  return { ok: true, extension: mimeType === "video/mp4" ? ".mp4" : mimeType === "video/quicktime" ? ".mov" : ".webm" };
}

export function isSafeRecordingFilename(filename) {
  return typeof filename === "string" && /^[a-f0-9-]{36}\.(webm|mp4|mov)$/i.test(filename);
}
