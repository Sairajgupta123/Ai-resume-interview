import test from "node:test";
import assert from "node:assert/strict";
import { isEmployerUserSessionPayload } from "../lib/employer-session-policy.mjs";

const now = 1_800_000_000_000;
const valid = { v: 2, sub: "user_123", sv: 0, iat: now };

test("accepts a valid, current employer identity session payload", () => {
  assert.equal(isEmployerUserSessionPayload(valid, now), true);
});

test("rejects malformed identity, version, and session-version claims", () => {
  for (const payload of [
    null,
    [],
    { ...valid, v: 1 },
    { ...valid, sub: "" },
    { ...valid, sub: "x".repeat(129) },
    { ...valid, sv: -1 },
    { ...valid, sv: 1.5 },
    { ...valid, iat: "1800000000000" },
  ]) {
    assert.equal(isEmployerUserSessionPayload(payload, now), false);
  }
});

test("rejects expired and future-issued sessions", () => {
  assert.equal(isEmployerUserSessionPayload({ ...valid, iat: now - 12 * 60 * 60 * 1000 }, now), false);
  assert.equal(isEmployerUserSessionPayload({ ...valid, iat: now + 1 }, now), false);
});

test("ignores non-security metadata while validating the signed identity claims", () => {
  assert.equal(isEmployerUserSessionPayload({ ...valid, displayName: "Recruiter" }, now), true);
});
