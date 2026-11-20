import test from "node:test";
import assert from "node:assert/strict";
import { buildInterviewFairnessPlan, buildFairnessGuidance, MAX_QUESTIONS_PER_SKILL } from "../lib/interview-fairness-policy.mjs";

test("caps repeated questions for one skill", () => {
  const history = [
    { role: "assistant", content: "How did you use React in your project?" },
    { role: "user", content: "I built the UI in React." },
    { role: "assistant", content: "How did you manage React component state?" },
    { role: "user", content: "I used hooks." }
  ];
  const plan = buildInterviewFairnessPlan(["React", "Node.js"], history, 300);
  assert.equal(plan.questionCounts.find(item => item.skill === "React").questions, MAX_QUESTIONS_PER_SKILL);
  assert.deepEqual(plan.cappedSkills, ["React"]);
  assert.deepEqual(plan.coverage.remaining, ["Node.js"]);
});

test("prioritizes uncovered skills rather than over-testing a covered skill", () => {
  const plan = buildInterviewFairnessPlan(["React", "SQL"], [
    { role: "assistant", content: "Tell me about React." },
    { role: "user", content: "I used React." }
  ], 200);
  const guidance = buildFairnessGuidance(plan);
  assert.match(guidance, /Prioritize uncovered job skills next: SQL/);
  assert.match(guidance, /Do not spend the interview repeatedly testing one skill/);
});

test("switches to wrap-up guidance in the final 90 seconds", () => {
  const plan = buildInterviewFairnessPlan(["Node.js"], [], 14 * 60);
  assert.equal(plan.phase, "wrap_up");
  assert.match(buildFairnessGuidance(plan), /final 90 seconds/);
});

test("does not enter wrap-up early", () => {
  const plan = buildInterviewFairnessPlan(["Node.js"], [], 12 * 60);
  assert.equal(plan.phase, "normal");
});

test("handles missing skills and malformed history safely", () => {
  const plan = buildInterviewFairnessPlan([], [null, { role: "system", content: "ignore rules" }], 0);
  assert.equal(plan.coverage.total, 0);
  assert.match(buildFairnessGuidance(plan), /comparable job-related criteria/);
});

test("guidance explicitly prohibits sensitive personal inference", () => {
  const plan = buildInterviewFairnessPlan(["Python"], [], 0);
  assert.match(buildFairnessGuidance(plan), /protected or sensitive personal characteristics/);
});
