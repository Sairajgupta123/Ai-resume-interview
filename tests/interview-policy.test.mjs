import test from "node:test";
import assert from "node:assert/strict";
import {
  INTERVIEW_LIMIT_SECONDS,
  elapsedInterviewSeconds,
  isInterviewTimeLimitReached,
  normalizeEvidence,
  isVerifiableEvidenceQuote,
  normalizeInterviewQuestion,
  findCandidateAnswerForQuestion
} from "../lib/interview-policy.mjs";

const now = Date.UTC(2026, 10, 20, 12, 0, 0);

test("elapsed interview time is zero before it starts", () => {
  assert.equal(elapsedInterviewSeconds(new Date(now + 5000), now), 0);
});

test("elapsed interview time uses whole seconds", () => {
  assert.equal(elapsedInterviewSeconds(new Date(now - 12_999), now), 12);
});

test("interview limit is not reached one second early", () => {
  assert.equal(isInterviewTimeLimitReached(new Date(now - (INTERVIEW_LIMIT_SECONDS - 1) * 1000), now), false);
});

test("interview limit is reached at exactly fifteen minutes", () => {
  assert.equal(isInterviewTimeLimitReached(new Date(now - INTERVIEW_LIMIT_SECONDS * 1000), now), true);
});

test("invalid start timestamps do not produce NaN elapsed time", () => {
  assert.equal(elapsedInterviewSeconds("not-a-date", now), 0);
});

test("evidence normalization ignores only case and whitespace", () => {
  assert.equal(normalizeEvidence("  Built  REST APIs "), "built rest apis");
});

test("evidence must be a contiguous quote from one answer", () => {
  const answers = ["I built REST APIs using Node.js.", "I deployed services with Docker."];
  assert.equal(isVerifiableEvidenceQuote("built rest apis", answers), true);
  assert.equal(isVerifiableEvidenceQuote("REST APIs using Node.js", answers), true);
  assert.equal(isVerifiableEvidenceQuote("REST APIs deployed services", answers), false);
});

test("evidence cannot be assembled across separate answers", () => {
  const answers = ["I built REST APIs", "using Node.js for deployment"];
  assert.equal(isVerifiableEvidenceQuote("REST APIs using Node.js", answers), false);
});

test("short or fabricated evidence is rejected", () => {
  assert.equal(isVerifiableEvidenceQuote("Node", ["I use Node.js every day"]), false);
  assert.equal(isVerifiableEvidenceQuote("I led a team of ten engineers", ["I built REST APIs"]), false);
});

test("missing evidence has one explicit accepted sentinel", () => {
  assert.equal(isVerifiableEvidenceQuote("Insufficient evidence", []), true);
  assert.equal(isVerifiableEvidenceQuote("No evidence", []), false);
});

test("normalizes interviewer questions for transcript matching", () => {
  assert.equal(normalizeInterviewQuestion("  Explain REST APIs?  "), "explain rest apis");
});

test("finds only the candidate answer immediately following the matching question", () => {
  const history = [
    { role: "assistant", content: "Tell me about React." },
    { role: "user", content: "I built a React dashboard." },
    { role: "assistant", content: "How did you optimize SQL queries?" },
    { role: "user", content: "I added indexes to improve query speed." }
  ];
  assert.equal(findCandidateAnswerForQuestion("How did you optimize SQL queries?", history), "I added indexes to improve query speed.");
  assert.equal(findCandidateAnswerForQuestion("Tell me about React.", history), "I built a React dashboard.");
});

test("does not associate evidence with a different or unmatched question", () => {
  const history = [
    { role: "assistant", content: "Tell me about React." },
    { role: "user", content: "I built a React dashboard." }
  ];
  assert.equal(findCandidateAnswerForQuestion("Explain database normalization?", history), null);
});
