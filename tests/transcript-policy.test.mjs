import test from "node:test";
import assert from "node:assert/strict";
import { isTranscriptRetryCompatible, isNextTranscriptRole } from "../lib/transcript-policy.mjs";

test("a retry is accepted only when interview, speaker and content match", () => {
  const saved = { interviewId: "interview-1", role: "user", content: "My answer" };
  assert.equal(isTranscriptRetryCompatible(saved, { ...saved }), true);
  assert.equal(isTranscriptRetryCompatible(saved, { ...saved, content: "Changed answer" }), false);
  assert.equal(isTranscriptRetryCompatible(saved, { ...saved, role: "assistant" }), false);
  assert.equal(isTranscriptRetryCompatible(saved, { ...saved, interviewId: "interview-2" }), false);
  assert.equal(isTranscriptRetryCompatible(null, saved), false);
});

test("transcript turns alternate between candidate and interviewer", () => {
  assert.equal(isNextTranscriptRole("assistant", "user"), true);
  assert.equal(isNextTranscriptRole("user", "assistant"), true);
  assert.equal(isNextTranscriptRole("assistant", "assistant"), false);
  assert.equal(isNextTranscriptRole("user", "user"), false);
  assert.equal(isNextTranscriptRole("unknown", "user"), false);
});
