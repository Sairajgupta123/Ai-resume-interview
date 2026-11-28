export async function enqueueRecordingCleanupTask(db, { storedPath, reason, now = new Date() }) {
  if (!storedPath) return false;
  try {
    await db.recordingCleanupTask.create({
      data: {
        storedPath,
        reason,
        status: "pending",
        nextAttemptAt: now
      }
    });
    return true;
  } catch (error) {
    // The unique storedPath makes enqueue idempotent. Do not reset an active
    // lease or reopen a completed task when another request enqueues the same key.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return false;
    throw error;
  }
}
