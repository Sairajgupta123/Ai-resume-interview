export async function rotateCandidateInvitationToken(db, { sessionId, currentTokenHash, sessionTokenHash, now = new Date() }) {
  if (!sessionId || !currentTokenHash || !sessionTokenHash || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return false;
  }
  const changed = await db.interview.updateMany({
    where: {
      id: sessionId,
      invitationTokenHash: currentTokenHash,
      status: "invited",
      startedAt: null,
      inviteUsedAt: null,
      inviteExpiresAt: { gt: now }
    },
    data: {
      invitationTokenHash: sessionTokenHash,
      inviteUsedAt: now
    }
  });
  return changed.count === 1;
}

export async function replacePendingCandidateInvitation(db, { sessionId, currentTokenHash, nextTokenHash, expiresAt }) {
  if (!sessionId || !currentTokenHash || !nextTokenHash ||
      !(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) {
    return false;
  }
  const changed = await db.interview.updateMany({
    where: {
      id: sessionId,
      invitationTokenHash: currentTokenHash,
      status: "invited",
      startedAt: null,
      inviteUsedAt: null
    },
    data: {
      invitationTokenHash: nextTokenHash,
      inviteExpiresAt: expiresAt,
      inviteUsedAt: null
    }
  });
  return changed.count === 1;
}
