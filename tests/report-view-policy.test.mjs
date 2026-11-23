import test from "node:test";
import assert from "node:assert/strict";
import { parseQuestionAssessment, summarizeQuestionAssessments } from "../lib/report-view-policy.mjs";

test("parses explicit question assessment labels without changing the explanation", () => {
  assert.deepEqual(parseQuestionAssessment("Correct: The explanation is accurate."), {
    status: "Correct",
    detail: "The explanation is accurate."
  });
  assert.deepEqual(parseQuestionAssessment("Partially correct — The main idea is right, but the example is missing."), {
    status: "Partially correct",
    detail: "The main idea is right, but the example is missing."
  });
  assert.equal(parseQuestionAssessment("Incorrect: The central claim is wrong.").status, "Incorrect");
  assert.equal(parseQuestionAssessment("Unanswered").status, "Unanswered");
});

test("does not guess a label when an assessment has no recognized prefix", () => {
  assert.deepEqual(parseQuestionAssessment("The answer discusses a different topic."), {
    status: "Unclassified",
    detail: "The answer discusses a different topic."
  });
  assert.equal(parseQuestionAssessment(null).status, "Unclassified");
});

test("summarizes recognized question statuses and retains unclassified entries", () => {
  assert.deepEqual(summarizeQuestionAssessments([
    { assessment: "Correct: Good explanation." },
    { assessment: "Partially correct: Missing one detail." },
    { assessment: "Incorrect: Wrong core concept." },
    { assessment: "Unanswered: No response." },
    { assessment: "No clear status prefix." }
  ]), {
    total: 5,
    Correct: 1,
    "Partially correct": 1,
    Incorrect: 1,
    Unanswered: 1,
    Unclassified: 1
  });
});
