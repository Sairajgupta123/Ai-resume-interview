import test from "node:test";
import assert from "node:assert/strict";
import { createDeletionVerificationToken, hashDeletionVerificationToken, verifyDeletionVerificationToken, canVerifyDeletionRequest, canSendDeletionVerification, DELETION_VERIFICATION_RESEND_COOLDOWN_MS, MAX_DELETION_VERIFICATION_ATTEMPTS } from "../lib/deletion-verification-policy.mjs";

test("creates high-entropy URL-safe tokens and stores only a one-way hash", () => {
  const token = createDeletionVerificationToken();
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  const hash = hashDeletionVerificationToken(token);
  assert.notEqual(hash, token);
  assert.equal(verifyDeletionVerificationToken(token, hash), true);
});

test("rejects malformed, wrong and tampered tokens", () => {
  const hash = hashDeletionVerificationToken(createDeletionVerificationToken());
  assert.equal(verifyDeletionVerificationToken("short", hash), false);
  assert.equal(verifyDeletionVerificationToken(null, hash), false);
  assert.equal(verifyDeletionVerificationToken("x".repeat(43), hash), false);
  assert.equal(verifyDeletionVerificationToken("x".repeat(43), "not-a-hash"), false);
});

test("verification is allowed only for pending requests before expiry", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  const base = { status: "pending_candidate_verification", verificationExpiresAt: new Date("2026-11-20T10:30:00Z"), verificationAttempts: 0 };
  assert.equal(canVerifyDeletionRequest(base, now), true);
  assert.equal(canVerifyDeletionRequest({ ...base, status: "verified_pending_approval" }, now), false);
  assert.equal(canVerifyDeletionRequest({ ...base, verificationExpiresAt: now }, now), false);
});

test("locks verification after maximum attempts", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  const base = { status: "pending_candidate_verification", verificationExpiresAt: new Date("2026-11-20T10:30:00Z"), verificationAttempts: MAX_DELETION_VERIFICATION_ATTEMPTS };
  assert.equal(canVerifyDeletionRequest(base, now), false);
});

test("resend policy requires a cooldown and allows a new request after it", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  const base = { status: "pending_candidate_verification", verificationSentAt: new Date(now.getTime() - 30_000) };
  assert.equal(canSendDeletionVerification(base, now), false);
  assert.equal(
    canSendDeletionVerification({
      ...base,
      verificationSentAt: new Date(now.getTime() - DELETION_VERIFICATION_RESEND_COOLDOWN_MS)
    }, now),
    true
  );
  assert.equal(canSendDeletionVerification({ ...base, verificationSentAt: null }, now), true);
  assert.equal(canSendDeletionVerification({ ...base, status: "verified_pending_approval" }, now), false);
  assert.equal(canSendDeletionVerification(null, now), false);
});
