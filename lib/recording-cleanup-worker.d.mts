export function processRecordingCleanupBatch(args: {
  db: any;
  deleteRecording: (storedPath: string) => Promise<unknown>;
  now?: Date;
}): Promise<{ ok: true; inspected: number; completed: number; retryScheduled: number; skipped: number }>;
