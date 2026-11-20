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

export async function reserveDeletionVerificationEmail(db, {
  requestId,
  tokenHash,
  now,
  expiresAt,
  cooldownMs
}) {
  const resendAllowedBefore = new Date(now.getTime() - cooldownMs);
  const reserved = await db.privacyDeletionRequest.updateMany({
    where: {
      id: requestId,
      status: "pending_candidate_verification",
      OR: [
        { verificationSentAt: null },
        { verificationSentAt: { lte: resendAllowedBefore } }
      ]
    },
    data: {
      verificationTokenHash: tokenHash,
      verificationExpiresAt: expiresAt,
      verificationSentAt: now,
      verificationAttempts: 0
    }
  });
  return reserved.count === 1;
}

export async function recordDeletionVerificationEmailSent(db, requestId, tokenHash) {
  return db.$transaction(async tx => {
    const current = await tx.privacyDeletionRequest.findFirst({
      where: {
        id: requestId,
        status: "pending_candidate_verification",
        verificationTokenHash: tokenHash
      },
      select: { id: true }
    });
    if (!current) return false;

    await tx.privacyDeletionEvent.create({
      data: {
        requestId,
        action: "verification_email_sent",
        actor: "employer",
        details: "A time-limited verification link was sent to the candidate email snapshot captured when the deletion request was opened."
      }
    });
    return true;
  });
}

export async function recordDeletionVerificationEmailFailure(db, requestId, tokenHash) {
  return db.$transaction(async tx => {
    const cleared = await tx.privacyDeletionRequest.updateMany({
      where: {
        id: requestId,
        status: "pending_candidate_verification",
        verificationTokenHash: tokenHash
      },
      data: {
        verificationTokenHash: null,
        verificationExpiresAt: null,
        verificationSentAt: null
      }
    });
    if (cleared.count !== 1) return false;

    await tx.privacyDeletionEvent.create({
      data: {
        requestId,
        action: "verification_email_failed",
        actor: "system",
        details: "Verification email delivery failed. The unused link was invalidated and the request remains available for retry."
      }
    });
    return true;
  });
}
