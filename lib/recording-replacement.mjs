function reportCleanupError(onCleanupError, error, stage) {
  // Observability hooks must never change the outcome of the database commit or
  // turn best-effort cleanup into a failed recording upload response.
  try {
    onCleanupError(error, stage);
  } catch {
    // Preserve the primary operation result; a logger failure is secondary.
  }
}

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
        reportCleanupError(onCleanupError, referenceCheckError, "new-recording-reference-check-after-commit-error");
      }
    }
    if (safeToCleanup) {
      try {
        await cleanupNew();
      } catch (cleanupError) {
        reportCleanupError(onCleanupError, cleanupError, "new-recording-after-commit-error");
      }
    }
    throw error;
  }

  if (result?.count !== 1) {
    try {
      await cleanupNew();
    } catch (cleanupError) {
      reportCleanupError(onCleanupError, cleanupError, "new-recording-after-conflict");
    }
    return { ok: false, conflict: true };
  }

  if (previousPath) {
    try {
      await cleanupPrevious(previousPath);
    } catch (cleanupError) {
      reportCleanupError(onCleanupError, cleanupError, "previous-recording-after-replacement");
    }
  }

  return { ok: true, conflict: false };
}
