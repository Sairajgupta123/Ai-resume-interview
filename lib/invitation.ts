import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { canExchangeCandidateInvitation, isCandidateInvitationActive } from "./invitation-policy.mjs";
import { rotateCandidateInvitationToken } from "./invitation-service.mjs";

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

/** Validate the browser-session cookie for refresh/report recovery, including completed interviews. */
export async function hasValidCandidateSession(sessionId: string, token: string | null) {
  if (!token || token.length < 32 || token.length > 256) return false;
  const interview = await db.interview.findUnique({
    where: { id: sessionId },
    select: { invitationTokenHash: true, inviteExpiresAt: true, status: true }
  });
  if (
    !interview?.invitationTokenHash ||
    !(interview.inviteExpiresAt instanceof Date) ||
    !Number.isFinite(interview.inviteExpiresAt.getTime()) ||
    interview.inviteExpiresAt.getTime() <= Date.now() ||
    !["invited", "in_progress", "completed"].includes(interview.status)
  ) return false;
  return tokenMatches(token, interview.invitationTokenHash);
}

// Atomically consumes the emailed link once and records the use before issuing an HttpOnly cookie.
export async function exchangeCandidateInvitation(sessionId: string, token: string | null) {
  if (!token || token.length < 32 || token.length > 256) return null;
  const interview = await db.interview.findUnique({
    where: { id: sessionId },
    select: { invitationTokenHash: true, inviteExpiresAt: true, status: true, startedAt: true, inviteUsedAt: true }
  });
  if (!interview?.invitationTokenHash) return null;
  if (!isCandidateInvitationActive(token, interview.inviteExpiresAt, interview.status)) return null;
  if (!canExchangeCandidateInvitation(interview.status, interview.startedAt, interview.inviteExpiresAt)) return null;
  if (interview.inviteUsedAt) return null;
  if (!tokenMatches(token, interview.invitationTokenHash)) return null;

  // The emailed bearer token is single-use. Replace its hash atomically with a
  // fresh browser-session token so replaying the original link cannot authenticate.
  const sessionToken = createInvitationToken();
  const rotated = await rotateCandidateInvitationToken(db, {
    sessionId,
    currentTokenHash: interview.invitationTokenHash,
    sessionTokenHash: hashInvitationToken(sessionToken),
    now: new Date()
  });
  return rotated ? sessionToken : null;
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
