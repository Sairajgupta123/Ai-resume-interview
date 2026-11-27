function reportCleanupError(onCleanupError, error, stage) {
  // Observability hooks must never change the outcome of the database commit or
  // turn best-effort cleanup into a failed recording upload response.
  try {
    onCleanupError(error, stage);
  } catch {
    // Preserve the primary operation result; a logger failure is secondary.
  }
}

async function cleanupWithFallback({ cleanup, enqueueCleanup, storedPath, reason, onCleanupError, stage }) {
  try {
    await cleanup();
  } catch (error) {
    reportCleanupError(onCleanupError, error, stage);
    if (enqueueCleanup && storedPath) {
      try {
        await enqueueCleanup(storedPath, reason);
      } catch (queueError) {
        reportCleanupError(onCleanupError, queueError, stage + "-queue-failed");
      }
    }
  }
}

export async function commitRecordingReplacement({
  commit,
  cleanupNew,
  cleanupNewPath,
  cleanupPrevious,
  previousPath,
  isNewRecordingReferenced,
  enqueueCleanup,
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
        if (enqueueCleanup) {
          try {
            // The worker rechecks the interview reference before deleting. This
            // task is safe even though the commit outcome remains ambiguous.
            await enqueueCleanup("ambiguous_new_upload", "new-recording-after-commit-reference-check-failed");
          } catch (queueError) {
            reportCleanupError(onCleanupError, queueError, "new-recording-after-commit-queue-failed");
          }
        }
      }
    }
    if (safeToCleanup) {
      await cleanupWithFallback({
        cleanup: cleanupNew,
        enqueueCleanup: enqueueCleanup ? (reason, stage) => enqueueCleanup(reason, stage) : undefined,
        storedPath: cleanupNewPath,
        reason: "new-recording-after-commit-error",
        onCleanupError,
        stage: "new-recording-after-commit-error"
      });
    }
    throw error;
  }

  if (result?.count !== 1) {
    await cleanupWithFallback({
      cleanup: cleanupNew,
      enqueueCleanup: enqueueCleanup ? (reason, stage) => enqueueCleanup(reason, stage) : undefined,
      storedPath: cleanupNewPath,
      reason: "new-recording-after-conflict",
      onCleanupError,
      stage: "new-recording-after-conflict"
    });
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
