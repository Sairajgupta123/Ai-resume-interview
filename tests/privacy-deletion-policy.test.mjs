import test from "node:test";
import assert from "node:assert/strict";
import { validateDeletionRequestInput, normalizeIdentityValue, DELETION_CONFIRMATION_PHRASE } from "../lib/privacy-deletion-policy.mjs";

const interview = { candidateName: "Sairaj Dilip Gupta", candidateEmail: "candidate@example.com", role: "Backend Engineer" };
const valid = { candidateName: "  Sairaj   Dilip Gupta ", candidateEmail: "CANDIDATE@example.com", confirmation: DELETION_CONFIRMATION_PHRASE, reason: "Candidate requested removal of personal interview data." };

test("normalizes identity text without changing the stored record", () => {
  assert.equal(normalizeIdentityValue("  Sairaj   Dilip Gupta "), "sairaj dilip gupta");
});

test("accepts a well-formed request when candidate name and recorded email match", () => {
  const result = validateDeletionRequestInput(valid, interview);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.candidateName, interview.candidateName);
    assert.equal(result.value.candidateEmail, interview.candidateEmail);
  }
});

test("rejects a candidate name that does not match the selected interview", () => {
  const result = validateDeletionRequestInput({ ...valid, candidateName: "Another Candidate" }, interview);
  assert.equal(result.ok, false);
});

test("requires exact recorded email when the interview has an email", () => {
  const result = validateDeletionRequestInput({ ...valid, candidateEmail: "other@example.com" }, interview);
  assert.equal(result.ok, false);
});

test("does not invent an email when no email is stored", () => {
  const result = validateDeletionRequestInput({ ...valid, candidateEmail: "" }, { ...interview, candidateEmail: null });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.candidateEmail, null);
});

test("requires explicit confirmation phrase and a meaningful reason", () => {
  assert.equal(validateDeletionRequestInput({ ...valid, confirmation: "yes" }, interview).ok, false);
  assert.equal(validateDeletionRequestInput({ ...valid, reason: "short" }, interview).ok, false);
  assert.equal(validateDeletionRequestInput({ ...valid, reason: "x".repeat(1001) }, interview).ok, false);
});

test("rejects malformed request bodies", () => {
  assert.equal(validateDeletionRequestInput(null, interview).ok, false);
  assert.equal(validateDeletionRequestInput([], interview).ok, false);
});
