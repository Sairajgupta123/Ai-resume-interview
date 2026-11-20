import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSkillName,
  hasDuplicateSkills,
  isRatingEvidenceConsistent,
  calculateEvidenceCoverage,
  deriveRecommendation
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

test("derives conservative recommendations from score and evidence coverage", () => {
  assert.equal(deriveRecommendation(92, 90), "Strong match");
  assert.equal(deriveRecommendation(78, 60), "Consider");
  assert.equal(deriveRecommendation(90, 40), "Needs review");
  assert.equal(deriveRecommendation(55, 100), "Needs review");
});
