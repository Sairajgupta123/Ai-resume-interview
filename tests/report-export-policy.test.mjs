import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReportForExport } from "../lib/report-export-policy.mjs";

test("normalizes a valid report while retaining export fields", () => {
  const report = normalizeReportForExport({
    summary: "Good technical fundamentals",
    skills: [{ skill: "JavaScript", rating: "Strong", evidence: "Explained closures" }],
    questionFeedback: [{ question: "What is a promise?", assessment: "Clear", evidence: "Covered async flow" }],
    strengths: ["Communication"],
    improvementAreas: ["System design"]
  });
  assert.equal(report.summary, "Good technical fundamentals");
  assert.equal(report.skills[0].skill, "JavaScript");
  assert.equal(report.questionFeedback[0].question, "What is a promise?");
  assert.deepEqual(report.strengths, ["Communication"]);
  assert.deepEqual(report.improvementAreas, ["System design"]);
});

test("malformed JSON and unsupported top-level values produce an empty report", () => {
  assert.deepEqual(normalizeReportForExport("{broken"), {
    summary: "", skills: [], questionFeedback: [], strengths: [], improvementAreas: []
  });
  assert.deepEqual(normalizeReportForExport(["not", "an", "object"]), {
    summary: "", skills: [], questionFeedback: [], strengths: [], improvementAreas: []
  });
});

test("filters null, primitive and array entries before mapping report rows", () => {
  const report = normalizeReportForExport({
    skills: [null, "bad", [], { skill: "SQL", rating: "Good", evidence: "Used joins" }],
    questionFeedback: [null, 7, { question: "Index?", assessment: "Partial", evidence: "Needs detail" }],
    strengths: [null, 4, "Problem solving"],
    improvementAreas: [{ text: "unsafe" }, "Testing"]
  });
  assert.deepEqual(report.skills, [{ skill: "SQL", rating: "Good", evidence: "Used joins" }]);
  assert.deepEqual(report.questionFeedback, [{ question: "Index?", assessment: "Partial", evidence: "Needs detail" }]);
  assert.deepEqual(report.strengths, ["Problem solving"]);
  assert.deepEqual(report.improvementAreas, ["Testing"]);
});

test("bounds report text and collection sizes", () => {
  const report = normalizeReportForExport({
    summary: "x".repeat(15_000),
    skills: Array.from({ length: 150 }, (_, index) => ({ skill: String(index) })),
    strengths: Array.from({ length: 150 }, (_, index) => String(index))
  });
  assert.equal(report.summary.length, 12_000);
  assert.equal(report.skills.length, 100);
  assert.equal(report.strengths.length, 100);
  assert.equal(report.skills[0].skill, "0");
});
