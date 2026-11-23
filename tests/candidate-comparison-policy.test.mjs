import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateComparison } from "../lib/candidate-comparison-policy.mjs";

const candidate = (id, name, role, skills, score = 80) => {
  const coverage = skills.length
    ? Math.round((skills.filter(item => item?.evidence !== "Insufficient evidence" && typeof item?.evidence === "string" && item.evidence.trim().length >= 8).length / skills.length) * 100)
    : 0;
  const recommendation = coverage < 50
    ? "Needs review"
    : score >= 80 && coverage >= 75
      ? "Strong match"
      : score >= 60
        ? "Consider"
        : "Needs review";
  return {
  id, candidateName: name, role, overallScore: score, recommendation,
  reportJson: JSON.stringify({
    overallScore: score,
    recommendation,
    summary: "Demonstrated job-related technical knowledge.",
    strengths: [],
    improvementAreas: [],
    skills,
    questionFeedback: [],
    disclaimer: "AI assessment is advisory and requires human review."
  })
  };
};

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

test("rejects missing, malformed or incomplete reports", () => {
  assert.throws(() => buildCandidateComparison([
    candidate("a", "A", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }]),
    { id: "b", candidateName: "B", role: "Engineer", reportJson: "{broken" }
  ]), /valid completed report/);
  assert.throws(() => buildCandidateComparison([
    candidate("a", "A", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }]),
    { id: "b", candidateName: "B", role: "Engineer", reportJson: JSON.stringify({ skills: [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }] }) }
  ]), /valid completed report/);
});

test("rejects invalid candidate identifiers and uses validated report metadata over stale columns", () => {
  assert.throws(() => buildCandidateComparison([
    candidate("", "A", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }]),
    candidate("b", "B", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }])
  ]), /valid completed report/);
  const result = buildCandidateComparison([
    { ...candidate("a", "A", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }], 80), overallScore: 999, recommendation: "Guaranteed hire" },
    candidate("b", "B", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL" }])
  ]);
  assert.equal(result.candidates[0].overallScore, 80);
  assert.equal(result.candidates[0].recommendation, "Strong match");
});

test("rejects oversized evidence in a report before comparison", () => {
  assert.throws(() => buildCandidateComparison([
    candidate("a", "A", "Engineer", [{ skill: "SQL", rating: "Strong", evidence: "x".repeat(1201) }]),
    candidate("b", "B", "Engineer", [{ skill: "SQL", rating: "Good", evidence: "I used SQL queries" }])
  ]), /valid completed report/);
});

test("does not promote missing evidence into a positive rating", () => {
  const result = buildCandidateComparison([
    candidate("a", "A", "Engineer", [{ skill: "SQL", rating: "Strong", evidence: "I built SQL reporting" }]),
    candidate("b", "B", "Engineer", [{ skill: "SQL", rating: "Insufficient evidence", evidence: "Insufficient evidence" }])
  ]);
  assert.equal(result.skills[0].candidates[1].rating, "Insufficient evidence");
  assert.equal(result.candidates[1].evidenceSkillCount, 0);
});
