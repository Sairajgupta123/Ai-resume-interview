export type RecordingReplacementResult = { ok: true; conflict: false } | { ok: false; conflict: true };
export function commitRecordingReplacement(args: {
  commit: () => Promise<{ count: number }>;
  cleanupNew: () => Promise<unknown>;
  cleanupNewPath?: string;
  cleanupPrevious: (path: string) => Promise<unknown>;
  previousPath?: string | null;
  isNewRecordingReferenced?: () => Promise<boolean>;
  enqueueCleanup?: (storedPath: string, reason: string) => Promise<unknown>;
  onCleanupError?: (error: unknown, stage: string) => void;
}): Promise<RecordingReplacementResult>;
