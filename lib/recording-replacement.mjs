export async function commitRecordingReplacement({
  commit,
  cleanupNew,
  cleanupPrevious,
  previousPath,
  onCleanupError = () => {}
}) {
  let result;
  try {
    result = await commit();
  } catch (error) {
    try {
      await cleanupNew();
    } catch (cleanupError) {
      onCleanupError(cleanupError, "new-recording-after-commit-error");
    }
    throw error;
  }

  if (result?.count !== 1) {
    try {
      await cleanupNew();
    } catch (cleanupError) {
      onCleanupError(cleanupError, "new-recording-after-conflict");
    }
    return { ok: false, conflict: true };
  }

  if (previousPath) {
    try {
      await cleanupPrevious(previousPath);
    } catch (cleanupError) {
      onCleanupError(cleanupError, "previous-recording-after-replacement");
    }
  }

  return { ok: true, conflict: false };
}
