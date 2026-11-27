import test from "node:test";
import assert from "node:assert/strict";
import {
  getVoiceSessionLimit,
  getVoiceSessionAttemptDecision,
  isVoiceSessionWindowExpired,
  VOICE_SESSION_BLOCK_MS,
  VOICE_SESSION_MAX_ATTEMPTS,
  VOICE_SESSION_WINDOW_MS
} from "../lib/voice-session-rate-limit-policy.mjs";

test("allows voice session credentials while no active block exists", () => {
  assert.deepEqual(getVoiceSessionLimit(null, 1000), { limited: false, retryAfterSeconds: 0 });
});

test("blocks credential minting during the cooldown and reports retry seconds", () => {
  const attempt = { blockedUntil: new Date(11_500), windowStartedAt: new Date(0) };
  assert.deepEqual(getVoiceSessionLimit(attempt, 1000), { limited: true, retryAfterSeconds: 11 });
});

test("does not keep an expired cooldown active", () => {
  const attempt = { blockedUntil: new Date(900), windowStartedAt: new Date(0) };
  assert.deepEqual(getVoiceSessionLimit(attempt, 1000), { limited: false, retryAfterSeconds: 0 });
});

test("expires the rolling window after five minutes", () => {
  const attempt = { windowStartedAt: new Date(1000) };
  assert.equal(isVoiceSessionWindowExpired(attempt, 1000 + VOICE_SESSION_WINDOW_MS - 1), false);
  assert.equal(isVoiceSessionWindowExpired(attempt, 1000 + VOICE_SESSION_WINDOW_MS), true);
});

test("expired rolling window clears an otherwise active cooldown", () => {
  const attempt = {
    windowStartedAt: new Date(1000),
    blockedUntil: new Date(1000 + VOICE_SESSION_WINDOW_MS + VOICE_SESSION_BLOCK_MS)
  };
  assert.deepEqual(
    getVoiceSessionLimit(attempt, 1000 + VOICE_SESSION_WINDOW_MS),
    { limited: false, retryAfterSeconds: 0 }
  );
});

test("keeps credential mint limits bounded and explicit", () => {
  assert.equal(VOICE_SESSION_MAX_ATTEMPTS, 12);
  assert.equal(VOICE_SESSION_BLOCK_MS, 5 * 60 * 1000);
});

test("allows exactly twelve reserved credential attempts and rejects the next concurrent reservation", () => {
  assert.deepEqual(getVoiceSessionAttemptDecision(11), { limited: false, shouldBlock: false });
  assert.deepEqual(getVoiceSessionAttemptDecision(12), { limited: false, shouldBlock: true });
  assert.deepEqual(getVoiceSessionAttemptDecision(13), { limited: true, shouldBlock: true });
});
