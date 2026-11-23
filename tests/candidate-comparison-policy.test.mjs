import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateComparison } from "../lib/candidate-comparison-policy.mjs";

const candidate = (id, name, role, skills, score = 80) => ({
  id, candidateName: name, role, overallScore: score, recommendation: "Consider",
  reportJson: JSON.stringify({ skills })
});

test("compares skill evidence across candidates without choosing a winner", () => {
  const result = buildCandidateComparison([
    candidate("a", "Candidate A", "Backend Engineer", [
      { skill: "Node.js", rating: "Strong", evidence: "I built a REST API" },
      { skill: "SQL", rating: "Good", evidence: "I optimized SQL queries" }
    ]),
    candidate("b", "Candidate B", "Backend Engineer", [
      { skill: "Node.js", rating: "Good", evidence: "I built an API service" },
      { skill: "Docker", rating: "Strong", evidence: "I deployed containers" }
    ])
  ]);
  assert.equal(result.sameRole, true);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.skills.length, 3);
  const sql = result.skills.find(item => item.skill === "SQL");
  assert.equal(sql.candidates[1].rating, "Insufficient evidence");
  assert.match(result.comparisonNote, /not proof of missing ability/);
  assert.equal("winner" in result, false);
});

test("normalizes skill names and ignores duplicate skill rows safely", () => {
  const result = buildCandidateComparison([
    candidate("a", "A", "Engineer", [
      { skill: " React ", rating: "Good", evidence: "I built components" },
      { skill: "react", rating: "Strong", evidence: "duplicate row ignored" }
    ]),
    candidate("b", "B", "Engineer", [
      { skill: "REACT", rating: "Developing", evidence: "I used React" }
    ])
  ]);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].candidates[0].rating, "Good");
});

test("warns when selected candidates have different role labels", () => {
  const result = buildCandidateComparison([
    candidate("a", "A", "Frontend Engineer", [{ skill: "React", rating: "Good", evidence: "I used React" }]),
    candidate("b", "B", "Data Analyst", [{ skill: "SQL", rating: "Strong", evidence: "I wrote SQL queries" }])
  ]);
  assert.equal(result.sameRole, false);
  assert.match(result.comparisonNote, /different role labels/);
});

test("rejects fewer than two or more than three candidates", () => {
  assert.throws(() => buildCandidateComparison([]), /two and three/);
  assert.throws(() => buildCandidateComparison([candidate("a", "A", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }])]), /two and three/);
});

test("rejects missing or malformed skill reports", () => {
  assert.throws(() => buildCandidateComparison([
    candidate("a", "A", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }]),
    { id: "b", candidateName: "B", role: "Engineer", reportJson: "{broken" }
  ]), /valid completed report/);
});

test("rejects invalid candidate identifiers and clamps untrusted score and recommendation metadata", () => {
  assert.throws(() => buildCandidateComparison([
    candidate("", "A", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }]),
    candidate("b", "B", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }])
  ]), /valid completed report/);
  const result = buildCandidateComparison([
    { ...candidate("a", "A", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }], 999), recommendation: "Guaranteed hire" },
    candidate("b", "B", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }])
  ]);
  assert.equal(result.candidates[0].overallScore, null);
  assert.equal(result.candidates[0].recommendation, "Needs review");
});

test("treats oversized or malformed skill evidence as insufficient evidence", () => {
  const result = buildCandidateComparison([
    candidate("a", "A", "Engineer", [{ skill: "SQL", rating: "Strong", evidence: "x".repeat(1201) }]),
    candidate("b", "B", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL queries" }])
  ]);
  assert.equal(result.skills[0].candidates[0].rating, "Strong");
  assert.equal(result.skills[0].candidates[0].evidence, "Insufficient evidence");
  assert.equal(result.candidates[0].evidenceSkillCount, 0);
});

test("does not promote missing evidence into a positive rating", () => {
  const result = buildCandidateComparison([
    candidate("a", "A", "Engineer", [{ skill: "SQL", rating: "Strong", evidence: "I built SQL reporting" }]),
    candidate("b", "B", "Engineer", [{ skill: "SQL", rating: "Insufficient evidence", evidence: "Insufficient evidence" }])
  ]);
  assert.equal(result.skills[0].candidates[1].rating, "Insufficient evidence");
  assert.equal(result.candidates[1].evidenceSkillCount, 0);
});
