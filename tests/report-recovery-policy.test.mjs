import test from "node:test";
import assert from "node:assert/strict";
import { isRestorableInterviewReport } from "../lib/report-recovery-policy.mjs";

const validReport = () => ({
  overallScore: 82,
  recommendation: "Strong match",
  summary: "Demonstrated solid technical fundamentals.",
  strengths: ["Problem solving"],
  improvementAreas: ["System design depth"],
  skills: [{ skill: "JavaScript", rating: "Strong", evidence: "I built a JavaScript API service." }],
  questionFeedback: [{ question: "Explain closures.", assessment: "Clear explanation.", evidence: "I used closures in a project." }],
  disclaimer: "This report supports, but does not replace, human hiring judgment."
});

test("accepts a complete report that matches the candidate report contract", () => {
  assert.equal(isRestorableInterviewReport(validReport()), true);
});

test("rejects malformed top-level values and invalid score or recommendation", () => {
  assert.equal(isRestorableInterviewReport(null), false);
  assert.equal(isRestorableInterviewReport([]), false);
  assert.equal(isRestorableInterviewReport({ ...validReport(), overallScore: 101 }), false);
  assert.equal(isRestorableInterviewReport({ ...validReport(), recommendation: "Hire immediately" }), false);
});

test("rejects missing, oversized and malformed report sections", () => {
  assert.equal(isRestorableInterviewReport({ ...validReport(), summary: "" }), false);
  assert.equal(isRestorableInterviewReport({ ...validReport(), strengths: Array(13).fill("x") }), false);
  assert.equal(isRestorableInterviewReport({ ...validReport(), skills: [null] }), false);
  assert.equal(isRestorableInterviewReport({ ...validReport(), questionFeedback: "not-an-array" }), false);
});

test("rejects unsupported skill ratings and overlong evidence", () => {
  assert.equal(isRestorableInterviewReport({ ...validReport(), skills: [{ skill: "SQL", rating: "Excellent", evidence: "I used SQL queries." }] }), false);
  assert.equal(isRestorableInterviewReport({ ...validReport(), skills: [{ skill: "SQL", rating: "Good", evidence: "x".repeat(1201) }] }), false);
});

test("rejects oversized feedback entries and invalid disclaimer", () => {
  assert.equal(isRestorableInterviewReport({ ...validReport(), questionFeedback: [{ question: "x".repeat(1001), assessment: "ok", evidence: "I used SQL queries." }] }), false);
  assert.equal(isRestorableInterviewReport({ ...validReport(), disclaimer: 42 }), false);
});
