import test from "node:test";
import assert from "node:assert/strict";
import { getLoginLimit, isLoginWindowExpired, nextLoginAttempt, LOGIN_BLOCK_MS, LOGIN_WINDOW_MS } from "../lib/login-rate-limit-policy.mjs";

const now = Date.UTC(2026, 10, 19, 12, 0, 0);

test("new identity is not rate limited", () => {
  assert.deepEqual(getLoginLimit(null, now), { limited: false, retryAfterSeconds: 0 });
});

test("four failed attempts do not yet block login", () => {
  const attempt = { attempts: 4, windowStartedAt: new Date(now - 1000), blockedUntil: null };
  assert.deepEqual(getLoginLimit(attempt, now), { limited: false, retryAfterSeconds: 0 });
});

test("fifth failed attempt starts a temporary block", () => {
  const next = nextLoginAttempt({ attempts: 4, windowStartedAt: new Date(now - 1000) }, now);
  assert.equal(next.attempts, 5);
  assert.equal(next.blockedUntil.getTime(), now + LOGIN_BLOCK_MS);
  assert.deepEqual(getLoginLimit(next, now), { limited: true, retryAfterSeconds: 900 });
});

test("retry-after rounds up to a whole second", () => {
  const attempt = { attempts: 5, windowStartedAt: new Date(now), blockedUntil: new Date(now + 1501) };
  assert.equal(getLoginLimit(attempt, now).retryAfterSeconds, 2);
});

test("expired block no longer limits login", () => {
  const attempt = { attempts: 5, windowStartedAt: new Date(now), blockedUntil: new Date(now - 1) };
  assert.equal(getLoginLimit(attempt, now).limited, false);
});

test("expired attempt window resets counter", () => {
  const attempt = { attempts: 4, windowStartedAt: new Date(now - LOGIN_WINDOW_MS) };
  assert.equal(isLoginWindowExpired(attempt, now), true);
  assert.deepEqual(nextLoginAttempt(attempt, now), {
    attempts: 1, windowStartedAt: new Date(now), blockedUntil: null
  });
});

test("attempt window remains active just before expiry", () => {
  const attempt = { attempts: 2, windowStartedAt: new Date(now - LOGIN_WINDOW_MS + 1) };
  assert.equal(isLoginWindowExpired(attempt, now), false);
  assert.equal(nextLoginAttempt(attempt, now).attempts, 3);
});
