import test from "node:test";
import assert from "node:assert/strict";
import { extractTargetSkills, buildSkillCoverage, buildCoverageGuidance, matchesSkillTerm, resolveQuestionSkills } from "../lib/skill-coverage-policy.mjs";

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

test("does not interpret the js suffix in Node.js as JavaScript", () => {
  assert.deepEqual(extractTargetSkills("We need Node.js for backend development."), ["Node.js"]);
});

test("matches skill mentions with the same boundaries used by target extraction", () => {
  assert.equal(matchesSkillTerm("How did you use JavaScript?", "Java"), false);
  assert.equal(matchesSkillTerm("How did you use Java?", "Java"), true);
  assert.equal(matchesSkillTerm("Tell me about Node.js APIs", "Node.js"), true);
  assert.equal(matchesSkillTerm("How did you use JS?", "JavaScript"), true);
  assert.equal(matchesSkillTerm("We used JSX components", "JS"), false);
  assert.equal(matchesSkillTerm("React Native project", "React"), true);
});

test("resolves question competencies only against required job skills", () => {
  assert.deepEqual(
    resolveQuestionSkills("How did you use JavaScript?", ["JavaScript", "Unlisted skill"], ["Java", "JavaScript", "Node.js"]),
    ["JavaScript"]
  );
  assert.deepEqual(
    resolveQuestionSkills("How did you use Node.js?", [], ["JavaScript", "Node.js"]),
    ["Node.js"]
  );
  assert.deepEqual(
    resolveQuestionSkills("Tell me about a challenge", [], ["JavaScript", "Node.js"]),
    []
  );
});
