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
  assert.equal(assessAnswerDepth("I implemented a React API integration and tested the result."), "probe");
});

test("increases follow-up depth only when multiple specificity signals exist", () => {
  const detailed = "I implemented a Node.js API and optimized PostgreSQL queries, reducing latency by 40%. We compared a Redis cache alternative because the database was the bottleneck, then tested the change.";
  assert.equal(assessAnswerDepth(detailed), "deepen");
});

test("guidance explicitly avoids treating brevity as low competence", () => {
  assert.match(buildAdaptiveGuidance("Short answer").instruction, /Do not treat brevity as low competence/);
});

test("guidance asks to verify reasoning before changing skills for probe answers", () => {
  assert.match(buildAdaptiveGuidance("I implemented a React API integration and tested the result.").instruction, /verify the candidate's personal contribution/);
});
