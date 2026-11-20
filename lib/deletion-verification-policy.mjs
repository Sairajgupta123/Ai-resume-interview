import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const DELETION_VERIFICATION_TTL_MS = 30 * 60 * 1000;
export const DELETION_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_DELETION_VERIFICATION_ATTEMPTS = 5;

export function createDeletionVerificationToken() {
  return randomBytes(32).toString("base64url");
}

export function hashDeletionVerificationToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyDeletionVerificationToken(token, storedHash) {
  if (typeof token !== "string" || token.length < 32 || token.length > 256) return false;
  if (typeof storedHash !== "string" || !/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const actual = Buffer.from(hashDeletionVerificationToken(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function canVerifyDeletionRequest(request, now = new Date()) {
  if (!request || request.status !== "pending_candidate_verification") return false;
  if (!request.verificationExpiresAt || new Date(request.verificationExpiresAt).getTime() <= now.getTime()) return false;
  if ((request.verificationAttempts ?? 0) >= MAX_DELETION_VERIFICATION_ATTEMPTS) return false;
  return true;
}

export function canSendDeletionVerification(request, now = new Date()) {
  if (!request || request.status !== "pending_candidate_verification") return false;
  if (!request.verificationSentAt) return true;
  const sentAt = new Date(request.verificationSentAt).getTime();
  return Number.isFinite(sentAt) && now.getTime() - sentAt >= DELETION_VERIFICATION_RESEND_COOLDOWN_MS;
}
