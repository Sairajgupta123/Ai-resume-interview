import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { canExchangeCandidateInvitation, isCandidateInvitationActive } from "./invitation-policy.mjs";

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token: string, storedHash: string) {
  const actual = Buffer.from(hashInvitationToken(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function hasValidCandidateInvitation(sessionId: string, token: string | null) {
  if (!token || token.length < 32 || token.length > 256) return false;
  const interview = await db.interview.findUnique({
    where: { id: sessionId },
    select: { invitationTokenHash: true, inviteExpiresAt: true, status: true }
  });
  if (!interview?.invitationTokenHash) return false;
  if (!isCandidateInvitationActive(token, interview.inviteExpiresAt, interview.status)) return false;
  return tokenMatches(token, interview.invitationTokenHash);
}

// Atomically consumes the emailed link once and records the use before issuing an HttpOnly cookie.
export async function exchangeCandidateInvitation(sessionId: string, token: string | null) {
  if (!token || token.length < 32 || token.length > 256) return false;
  const interview = await db.interview.findUnique({
    where: { id: sessionId },
    select: { invitationTokenHash: true, inviteExpiresAt: true, status: true, startedAt: true, inviteUsedAt: true }
  });
  if (!interview?.invitationTokenHash) return false;
  if (!isCandidateInvitationActive(token, interview.inviteExpiresAt, interview.status)) return false;
  if (!canExchangeCandidateInvitation(interview.status, interview.startedAt, interview.inviteExpiresAt)) return false;
  if (interview.inviteUsedAt) return false;
  if (!tokenMatches(token, interview.invitationTokenHash)) return false;

  const now = new Date();
  const consumed = await db.interview.updateMany({
    where: {
      id: sessionId,
      invitationTokenHash: interview.invitationTokenHash,
      status: "invited",
      startedAt: null,
      inviteUsedAt: null,
      inviteExpiresAt: { gt: now }
    },
    data: { inviteUsedAt: now }
  });
  return consumed.count === 1;
}

export function candidateInvitationCookieName(sessionId: string) {
  const sessionKey = createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
  return "mzobs_candidate_" + sessionKey;
}

type InvitationRequest = {
  cookies: { get(name: string): { value: string } | undefined };
};

export function getCandidateInvitationToken(request: InvitationRequest, sessionId: string) {
  return request.cookies.get(candidateInvitationCookieName(sessionId))?.value || null;
}

export function createInvitationToken() {
  return randomBytes(32).toString("base64url");
}
