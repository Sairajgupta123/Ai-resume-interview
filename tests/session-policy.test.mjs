import test from "node:test";
import assert from "node:assert/strict";
import { EMPLOYER_SESSION_MAX_AGE_SECONDS, isSessionTimestampValid } from "../lib/session-policy.mjs";

const now = Date.UTC(2026, 10, 20, 12, 0, 0);

test("a newly issued session timestamp is valid", () => {
  assert.equal(isSessionTimestampValid(String(now), now), true);
});

test("a session remains valid immediately before its twelve-hour expiry", () => {
  const issuedAt = now - (EMPLOYER_SESSION_MAX_AGE_SECONDS * 1000 - 1);
  assert.equal(isSessionTimestampValid(String(issuedAt), now), true);
});

test("a session expires at exactly twelve hours", () => {
  const issuedAt = now - EMPLOYER_SESSION_MAX_AGE_SECONDS * 1000;
  assert.equal(isSessionTimestampValid(String(issuedAt), now), false);
});

test("future-issued sessions are rejected", () => {
  assert.equal(isSessionTimestampValid(String(now + 1), now), false);
});

test("malformed timestamps are rejected", () => {
  for (const timestamp of ["", "not-a-time", "-100", "1.5", "1e3", "NaN"]) {
    assert.equal(isSessionTimestampValid(timestamp, now), false, timestamp);
  }
});

test("unsafe integer timestamps are rejected", () => {
  assert.equal(isSessionTimestampValid("999999999999999999999", now), false);
});
