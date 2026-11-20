import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hasValidCandidateInvitation(sessionId: string, token: string | null) {
  if (!token || token.length < 32 || token.length > 256) return false;
  const interview = await db.interview.findUnique({
    where: { id: sessionId },
    select: { invitationTokenHash: true, inviteExpiresAt: true, status: true }
  });
  if (!interview?.invitationTokenHash || !interview.inviteExpiresAt) return false;
  if (interview.status === "completed" || interview.inviteExpiresAt.getTime() < Date.now()) return false;

  const actual = Buffer.from(hashInvitationToken(token), "hex");
  const expected = Buffer.from(interview.invitationTokenHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}


export function candidateInvitationCookieName(sessionId: string) {
  const sessionKey = createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
  return `mzobs_candidate_${sessionKey}`;
}

type InvitationRequest = {
  headers: { get(name: string): string | null };
  cookies: { get(name: string): { value: string } | undefined };
};

export function getCandidateInvitationToken(request: InvitationRequest, sessionId: string) {
  return request.headers.get("x-interview-invite")
    || request.cookies.get(candidateInvitationCookieName(sessionId))?.value
    || null;
}

export function createInvitationToken() {
  return randomBytes(32).toString("base64url");
}
