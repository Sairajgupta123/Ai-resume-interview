import test from "node:test";
import assert from "node:assert/strict";
import { canExchangeCandidateInvitation, isCandidateInvitationActive } from "../lib/invitation-policy.mjs";

const now = Date.UTC(2026, 10, 20, 12, 0, 0);
const token = "a".repeat(43);

test("valid unexpired invitation is active", () => {
  assert.equal(isCandidateInvitationActive(token, new Date(now + 1000), "invited", now), true);
});

test("invitation is expired at the exact expiry instant", () => {
  assert.equal(isCandidateInvitationActive(token, new Date(now), "invited", now), false);
});

test("completed interviews cannot use an invitation", () => {
  assert.equal(isCandidateInvitationActive(token, new Date(now + 1000), "completed", now), false);
});

test("unknown and terminal lifecycle states cannot use a candidate invitation", () => {
  for (const status of ["completed", "cancelled", "deleted", "", null, undefined]) {
    assert.equal(isCandidateInvitationActive(token, new Date(now + 1000), status, now), false);
  }
});

test("missing, malformed and out-of-range tokens are rejected", () => {
  for (const value of [null, undefined, "", "short", "a".repeat(257), 123]) {
    assert.equal(isCandidateInvitationActive(value, new Date(now + 1000), "invited", now), false);
  }
});

test("expired and invalid expiry values are rejected", () => {
  assert.equal(isCandidateInvitationActive(token, new Date(now - 1), "invited", now), false);
  assert.equal(isCandidateInvitationActive(token, null, "invited", now), false);
});

test("only a not-yet-started invited interview can exchange its link token", () => {
  assert.equal(canExchangeCandidateInvitation("invited", null, new Date(now + 1000), now), true);
  assert.equal(canExchangeCandidateInvitation("in_progress", new Date(now - 1), new Date(now + 1000), now), false);
  assert.equal(canExchangeCandidateInvitation("invited", new Date(now - 1), new Date(now + 1000), now), false);
  assert.equal(canExchangeCandidateInvitation("completed", null, new Date(now + 1000), now), false);
});

test("link token exchange is rejected at expiry", () => {
  assert.equal(canExchangeCandidateInvitation("invited", null, new Date(now), now), false);
});
