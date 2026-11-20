import test from "node:test";
import assert from "node:assert/strict";
import { assessAnswerDepth, buildAdaptiveGuidance } from "../lib/adaptive-interview-policy.mjs";

test("uses clarification for empty or very short answers", () => {
  assert.equal(assessAnswerDepth(""), "clarify");
  assert.equal(assessAnswerDepth("I used React."), "clarify");
});

test("does not treat a long generic answer as demonstrated technical depth", () => {
  const generic = "I worked hard with my team and learned many things. ".repeat(8);
  assert.equal(assessAnswerDepth(generic), "clarify");
});

test("uses a focused probe when an answer has some concrete detail", () => {
  const answer = "I implemented a React API integration and tested the result across several user flows. I also documented the changes, checked the error states, and verified that the existing pages continued to work correctly for the team.";
  assert.equal(assessAnswerDepth(answer), "probe");
});

test("increases follow-up depth only when multiple specificity signals exist", () => {
  const detailed = "I implemented a Node.js API and optimized PostgreSQL queries, reducing latency by 40%. We compared a Redis cache alternative because the database was the bottleneck, then tested the change with representative traffic and documented the before and after results for the engineering team.";
  assert.equal(assessAnswerDepth(detailed), "deepen");
});

test("guidance explicitly avoids treating brevity as low competence", () => {
  assert.match(buildAdaptiveGuidance("Short answer").instruction, /Do not treat brevity as low competence/);
});

test("guidance asks for specific actions and outcomes when detail is limited", () => {
  const guidance = buildAdaptiveGuidance("Short answer");
  assert.match(guidance.instruction, /specific example/);
  assert.match(guidance.instruction, /candidate's own actions/);
});
