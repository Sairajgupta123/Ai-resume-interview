import test from "node:test";
import assert from "node:assert/strict";
import { isDecisionVersionCurrent, validateEmployerDecisionInput } from "../lib/employer-decision-policy.mjs";

const version = "2026-11-20T10:30:00.000Z";

test("accepts supported decisions with trimmed notes and an explicit current version", () => {
  const result = validateEmployerDecisionInput({
    decision: " SHORTLIST ",
    notes: "  Strong evidence against the required criteria.  ",
    expectedDecisionAt: null
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.decision, "shortlist");
    assert.equal(result.notes, "Strong evidence against the required criteria.");
    assert.equal(result.expectedDecisionAt, null);
  }
});

test("rejects unknown decisions, malformed notes and overlong notes", () => {
  assert.equal(validateEmployerDecisionInput({ decision: "hire", expectedDecisionAt: null }).ok, false);
  assert.equal(validateEmployerDecisionInput({ decision: "reject", notes: 42, expectedDecisionAt: null }).ok, false);
  assert.equal(validateEmployerDecisionInput({ decision: "reject", notes: "x".repeat(3001), expectedDecisionAt: null }).ok, false);
  assert.equal(validateEmployerDecisionInput(null).ok, false);
});

test("requires an explicit decision version to prevent stale overwrites", () => {
  assert.equal(validateEmployerDecisionInput({ decision: "review" }).ok, false);
  assert.equal(validateEmployerDecisionInput({ decision: "review", expectedDecisionAt: "not-a-date" }).ok, false);
  assert.equal(validateEmployerDecisionInput({ decision: "review", expectedDecisionAt: version }).ok, true);
});

test("compares nullable decision versions safely", () => {
  assert.equal(isDecisionVersionCurrent(null, null), true);
  assert.equal(isDecisionVersionCurrent(new Date(version), new Date(version)), true);
  assert.equal(isDecisionVersionCurrent(new Date(version), null), false);
  assert.equal(isDecisionVersionCurrent(null, new Date(version)), false);
  assert.equal(isDecisionVersionCurrent(new Date("2026-11-20T10:31:00.000Z"), new Date(version)), false);
});
