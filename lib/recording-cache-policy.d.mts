export type CachedRecordingSnapshot = { chunks: Blob[]; mimeType: string; complete: boolean };
export function inspectCachedRecordingRows(rows: unknown[]): CachedRecordingSnapshot | null;
