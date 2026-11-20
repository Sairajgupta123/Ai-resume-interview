export async function verifyDeletionRequest(db, requestId, tokenHash, now = new Date()) {
  return db.$transaction(async tx => {
    const changed = await tx.privacyDeletionRequest.updateMany({
      where: {
        id: requestId,
        status: "pending_candidate_verification",
        verificationTokenHash: tokenHash,
        verificationExpiresAt: { gt: now },
        verificationAttempts: { lt: 5 }
      },
      data: {
        status: "verified_pending_approval",
        verifiedAt: now,
        verificationTokenHash: null,
        verificationExpiresAt: null
      }
    });

    if (changed.count !== 1) return false;

    await tx.privacyDeletionEvent.create({
      data: {
        requestId,
        action: "candidate_verified",
        actor: "candidate",
        details: "Candidate completed verification using the time-limited email link."
      }
    });

    return true;
  });
}
