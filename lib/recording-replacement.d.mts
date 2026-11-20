export type RecordingReplacementResult = { ok: true; conflict: false } | { ok: false; conflict: true };
export function commitRecordingReplacement(args: {
  commit: () => Promise<{ count: number }>;
  cleanupNew: () => Promise<unknown>;
  cleanupPrevious: (path: string) => Promise<unknown>;
  previousPath?: string | null;
  onCleanupError?: (error: unknown, stage: string) => void;
}): Promise<RecordingReplacementResult>;
