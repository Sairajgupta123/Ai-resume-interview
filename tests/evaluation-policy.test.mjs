import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSkillName,
  hasDuplicateSkills,
  isRatingEvidenceConsistent,
  calculateEvidenceCoverage,
  deriveRecommendation,
  completeRequiredSkillEvaluations,
  isSkillEvidenceLinkedToQuestion
} from "../lib/evaluation-policy.mjs";

test("normalizes skill names for duplicate detection", () => {
  assert.equal(normalizeSkillName("  JavaScript   "), "javascript");
  assert.equal(hasDuplicateSkills([{ skill: "React" }, { skill: " react " }]), true);
  assert.equal(hasDuplicateSkills([{ skill: "React" }, { skill: "Node.js" }]), false);
});

test("rejects missing skill names", () => {
  assert.equal(hasDuplicateSkills([{ skill: " " }]), true);
});

test("requires insufficient-evidence rating to use the exact marker", () => {
  assert.equal(isRatingEvidenceConsistent("Insufficient evidence", "Insufficient evidence"), true);
  assert.equal(isRatingEvidenceConsistent("Insufficient evidence", "I think they know this"), false);
});

test("requires a supporting quote for substantive skill ratings", () => {
  assert.equal(isRatingEvidenceConsistent("Strong", "I built a REST API"), true);
  assert.equal(isRatingEvidenceConsistent("Good", "Insufficient evidence"), false);
});

test("calculates evidence coverage from supported quotes", () => {
  assert.equal(calculateEvidenceCoverage([
    { evidence: "I built a REST API" },
    { evidence: "Insufficient evidence" },
    { evidence: "I optimized SQL queries" },
    { evidence: "" }
  ]), 50);
  assert.equal(calculateEvidenceCoverage([]), 0);
});

test("derives conservative recommendations from overall and skill evidence coverage", () => {
  assert.equal(deriveRecommendation(92, 90, 90), "Strong match");
  assert.equal(deriveRecommendation(78, 60, 60), "Consider");
  assert.equal(deriveRecommendation(90, 90, 40), "Needs review");
  assert.equal(deriveRecommendation(90, 40, 100), "Needs review");
  assert.equal(deriveRecommendation(55, 100, 100), "Needs review");
});

test("does not infer strong skill evidence from question feedback alone", () => {
  const skillEvidenceCoverage = calculateEvidenceCoverage([
    { evidence: "Insufficient evidence" },
    { evidence: "Insufficient evidence" }
  ]);
  const overallEvidenceCoverage = calculateEvidenceCoverage([
    { evidence: "Insufficient evidence" },
    { evidence: "Insufficient evidence" },
    { evidence: "I explained how I deployed the service" },
    { evidence: "I debugged a production issue successfully" }
  ]);
  assert.equal(overallEvidenceCoverage, 50);
  assert.equal(skillEvidenceCoverage, 0);
  assert.equal(deriveRecommendation(95, overallEvidenceCoverage, skillEvidenceCoverage), "Needs review");
});

test("keeps two-argument recommendation calls backward compatible", () => {
  assert.equal(deriveRecommendation(92, 90), "Strong match");
});

test("adds an explicit insufficient-evidence row for every missing job skill", () => {
  const completed = completeRequiredSkillEvaluations(
    ["JavaScript", "Node.js", "SQL"],
    [{ skill: "JavaScript", rating: "Good", evidence: "I built browser features" }]
  );
  assert.deepEqual(completed, [
    { skill: "JavaScript", rating: "Good", evidence: "I built browser features" },
    { skill: "Node.js", rating: "Insufficient evidence", evidence: "Insufficient evidence" },
    { skill: "SQL", rating: "Insufficient evidence", evidence: "Insufficient evidence" }
  ]);
});

test("uses canonical skill aliases without confusing Java and JavaScript", () => {
  const completed = completeRequiredSkillEvaluations(
    ["Java", "JavaScript", "Node.js"],
    [
      { skill: "JavaScript", rating: "Good", evidence: "I wrote JavaScript modules" },
      { skill: "Node.js", rating: "Strong", evidence: "I built Node.js services" }
    ]
  );
  assert.deepEqual(completed.map(item => item.skill), ["JavaScript", "Node.js", "Java"]);
  assert.equal(completed[2].rating, "Insufficient evidence");
});

test("does not invent required skills when no job skills were extracted", () => {
  assert.deepEqual(completeRequiredSkillEvaluations([], [
    { skill: "Communication", rating: "Good", evidence: "I worked with the team" }
  ]), [{ skill: "Communication", rating: "Good", evidence: "I worked with the team" }]);
});

test("caps required-skill completion at the supported target limit", () => {
  const required = Array.from({ length: 20 }, (_, index) => "Skill " + index);
  assert.equal(completeRequiredSkillEvaluations(required, []).length, 15);
});

test("links a skill quote only to an answer for a question assessing that skill", () => {
  const feedback = [{
    testedSkills: ["React"],
    pairedAnswer: "I built reusable React components and tested them."
  }];
  assert.equal(isSkillEvidenceLinkedToQuestion("React", "I built reusable React components", feedback), true);
  assert.equal(isSkillEvidenceLinkedToQuestion("React", "I built reusable React components", [
    { testedSkills: ["Node.js"], pairedAnswer: "I built reusable React components and tested them." }
  ]), false);
});

test("does not accept evidence from an unrelated answer even if the quote exists in the transcript", () => {
  const feedback = [{
    testedSkills: ["SQL"],
    pairedAnswer: "I wrote optimized SQL queries for reporting."
  }];
  assert.equal(isSkillEvidenceLinkedToQuestion("React", "I wrote optimized SQL queries", feedback), false);
});

test("uses skill aliases without treating JavaScript evidence as Java evidence", () => {
  const feedback = [{
    testedSkills: ["JavaScript"],
    pairedAnswer: "I used JavaScript to build the frontend."
  }];
  assert.equal(isSkillEvidenceLinkedToQuestion("JavaScript", "I used JavaScript", feedback), true);
  assert.equal(isSkillEvidenceLinkedToQuestion("Java", "I used JavaScript", feedback), false);
});

test("rejects unsupported and empty skill evidence", () => {
  assert.equal(isSkillEvidenceLinkedToQuestion("React", "Insufficient evidence", [
    { testedSkills: ["React"], pairedAnswer: "I used React." }
  ]), false);
  assert.equal(isSkillEvidenceLinkedToQuestion("React", "I used React", []), false);
});


test("provides a consistent evidence-based rubric for skill ratings", async () => {
  const { buildSkillEvaluationGuidance } = await import("../lib/evaluation-policy.mjs");
  const guidance = buildSkillEvaluationGuidance();
  assert.match(guidance, /Strong: the answer is materially correct/);
  assert.match(guidance, /Good: the answer is mostly correct/);
  assert.match(guidance, /Developing: the answer shows some relevant understanding/);
  assert.match(guidance, /unanswered or unassessed competency as a failure/);
  assert.match(guidance, /answer length, speaking speed, accent/);
  assert.match(guidance, /concrete action, design, debugging step, or outcome/);
});


test("provides consistent labels for correct, partial, incorrect and unanswered responses", async () => {
  const { buildQuestionAssessmentGuidance } = await import("../lib/evaluation-policy.mjs");
  const guidance = buildQuestionAssessmentGuidance();
  for (const label of ["Correct", "Partially correct", "Incorrect", "Unanswered"]) {
    assert.ok(guidance.includes(label), `Missing assessment label: ${label}`);
  }
  assert.match(guidance, /conflict.*human review/i);
  assert.match(guidance, /Do not infer dishonesty/);
  assert.match(guidance, /candidate answer immediately following that question/);
});
