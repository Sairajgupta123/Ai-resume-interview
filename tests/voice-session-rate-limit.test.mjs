import assert from "node:assert/strict";
import test from "node:test";
import {
  getVoiceSessionRateLimit,
  VOICE_SESSION_MAX_MINTS,
  VOICE_SESSION_WINDOW_MS
} from "../lib/voice-session-rate-limit.mjs";

const now = Date.parse("2026-11-27T12:00:00.000Z");

test("first voice credential mint starts a fresh window", () => {
  const result = getVoiceSessionRateLimit(null, now);
  assert.equal(result.limited, false);
  assert.equal(result.attempts, 1);
  assert.equal(result.windowStartedAt.getTime(), now);
  assert.equal(result.resetWindow, true);
});

test("allows the configured number of mints inside the window", () => {
  const result = getVoiceSessionRateLimit({
    attempts: VOICE_SESSION_MAX_MINTS - 1,
    windowStartedAt: new Date(now - 1_000),
    blockedUntil: null
  }, now);
  assert.equal(result.limited, false);
  assert.equal(result.attempts, VOICE_SESSION_MAX_MINTS);
  assert.equal(result.resetWindow, false);
});

test("blocks the next mint after the shared window budget is exhausted", () => {
  const result = getVoiceSessionRateLimit({
    attempts: VOICE_SESSION_MAX_MINTS,
    windowStartedAt: new Date(now - 1_000),
    blockedUntil: null
  }, now);
  assert.equal(result.limited, true);
  assert.ok(result.retryAfterSeconds > 0);
});

test("honors an active block and reports its remaining retry time", () => {
  const result = getVoiceSessionRateLimit({
    attempts: VOICE_SESSION_MAX_MINTS + 1,
    windowStartedAt: new Date(now - 1_000),
    blockedUntil: new Date(now + 30_000)
  }, now);
  assert.equal(result.limited, true);
  assert.equal(result.retryAfterSeconds, 30);
});

test("resets an expired window and expired block", () => {
  const result = getVoiceSessionRateLimit({
    attempts: VOICE_SESSION_MAX_MINTS + 1,
    windowStartedAt: new Date(now - VOICE_SESSION_WINDOW_MS - 1),
    blockedUntil: new Date(now - 1)
  }, now);
  assert.equal(result.limited, false);
  assert.equal(result.attempts, 1);
  assert.equal(result.windowStartedAt.getTime(), now);
  assert.equal(result.resetWindow, true);
});

test("rejects an invalid current timestamp", () => {
  assert.throws(() => getVoiceSessionRateLimit(null, Number.NaN), /valid current timestamp/i);
});
