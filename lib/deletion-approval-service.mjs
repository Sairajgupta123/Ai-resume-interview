export async function approveVerifiedDeletionRequest(db, requestId) {
  return db.$transaction(async tx => {
    const changed = await tx.privacyDeletionRequest.updateMany({
      where: {
        id: requestId,
        status: "verified_pending_approval",
        verifiedAt: { not: null }
      },
      data: { status: "approved_for_deletion" }
    });

    if (changed.count !== 1) return false;

    await tx.privacyDeletionEvent.create({
      data: {
        requestId,
        action: "employer_approved",
        actor: "employer",
        details: "Employer approved the verified deletion request. Data deletion has not yet run."
      }
    });

    return true;
  });
}
