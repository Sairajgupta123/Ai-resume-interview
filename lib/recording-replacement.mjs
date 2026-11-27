export async function commitRecordingReplacement({
  commit,
  cleanupNew,
  cleanupPrevious,
  previousPath,
  isNewRecordingReferenced,
  onCleanupError = () => {}
}) {
  let result;
  try {
    result = await commit();
  } catch (error) {
    // A database request can fail after the server has committed its write but
    // before the client receives the response. Never delete the uploaded object
    // until a follow-up read confirms that no interview references it.
    let safeToCleanup = !isNewRecordingReferenced;
    if (isNewRecordingReferenced) {
      try {
        safeToCleanup = !(await isNewRecordingReferenced());
      } catch (referenceCheckError) {
        safeToCleanup = false;
        onCleanupError(referenceCheckError, "new-recording-reference-check-after-commit-error");
      }
    }
    if (safeToCleanup) {
      try {
        await cleanupNew();
      } catch (cleanupError) {
        onCleanupError(cleanupError, "new-recording-after-commit-error");
      }
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
