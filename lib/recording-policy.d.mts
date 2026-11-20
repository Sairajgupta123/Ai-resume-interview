export const MAX_RECORDING_BYTES: number;
export const ACCEPTED_RECORDING_TYPES: readonly string[];
export function inspectRecordingUpload(mimeType: string, size: number, bytes: Uint8Array): { ok: true; extension: string } | { ok: false; status: number; error: string };
export function isSafeRecordingFilename(filename: string): boolean;
