import test from "node:test";
import assert from "node:assert/strict";
import { extractTargetSkills, buildSkillCoverage, buildCoverageGuidance } from "../lib/skill-coverage-policy.mjs";

test("prioritizes skills found in the job description before resume-only skills", () => {
  assert.deepEqual(
    extractTargetSkills("We need React, Node.js and SQL.", "Candidate knows Python and Docker."),
    ["React", "Node.js", "SQL", "Python", "Docker"]
  );
});

test("matches common aliases without substring false positives", () => {
  assert.deepEqual(extractTargetSkills("Experience with JS, ReactJS and PostgreSQL."), ["JavaScript", "React", "SQL"]);
  assert.equal(extractTargetSkills("The role is for a JavaScript engineer.").includes("Java"), false);
});

test("tracks asked, answered and not-yet-covered skills from transcript turns", () => {
  const history = [
    { role: "assistant", content: "Can you explain how you used React in your project?" },
    { role: "user", content: "I built the component interface using React." },
    { role: "assistant", content: "What did you do with Node.js?" }
  ];
  const coverage = buildSkillCoverage(["React", "Node.js", "SQL"], history);
  assert.deepEqual(coverage.skills, [
    { skill: "React", status: "answered" },
    { skill: "Node.js", status: "asked_unanswered" },
    { skill: "SQL", status: "not_asked" }
  ]);
  assert.deepEqual(coverage.remaining, ["SQL"]);
  assert.deepEqual(coverage.followUp, ["Node.js"]);
  assert.equal(coverage.percent, 33);
});

test("does not mark a skill answered when no candidate response follows", () => {
  const coverage = buildSkillCoverage(["Python"], [
    { role: "assistant", content: "How have you used Python?" }
  ]);
  assert.equal(coverage.skills[0].status, "asked_unanswered");
});

test("coverage guidance distinguishes follow-up and missing skills", () => {
  const guidance = buildCoverageGuidance({
    skills: [], answered: 1, total: 3, percent: 33,
    remaining: ["SQL"], followUp: ["React"]
  });
  assert.match(guidance, /React/);
  assert.match(guidance, /SQL/);
  assert.match(guidance, /not a candidate score/);
});

test("handles an empty skill target without inventing coverage", () => {
  assert.deepEqual(extractTargetSkills("", ""), []);
  assert.match(buildCoverageGuidance({ skills: [], answered: 0, total: 0, percent: 0, remaining: [], followUp: [] }), /do not invent required skills/);
});

test("matches skills followed by punctuation and preserves plus and dot aliases", () => {
  assert.deepEqual(
    extractTargetSkills("Required: C++, Node.js, React, SQL."),
    ["React", "Node.js", "C++", "SQL"]
  );
});

test("does not match a skill name embedded inside a longer word", () => {
  assert.deepEqual(extractTargetSkills("The role needs JavaScript engineering."), ["JavaScript"]);
});
