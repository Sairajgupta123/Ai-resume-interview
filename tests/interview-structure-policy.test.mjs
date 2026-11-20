import test from "node:test";
import assert from "node:assert/strict";
import { buildInterviewStructurePlan, buildInterviewStructureGuidance, classifyInterviewQuestion } from "../lib/interview-structure-policy.mjs";

test("classifies the four interview question categories", () => {
  assert.equal(classifyInterviewQuestion("Explain how database indexing works."), "technical");
  assert.equal(classifyInterviewQuestion("How would you debug a slow API?"), "practical");
  assert.equal(classifyInterviewQuestion("Tell me about a project you built."), "project");
  assert.equal(classifyInterviewQuestion("How would you handle a production outage?"), "situational");
});

test("plans the least-covered question category first", () => {
  const history = [
    { role: "assistant", content: "Explain how database indexing works." },
    { role: "assistant", content: "What is an API?" },
    { role: "assistant", content: "Tell me about a project you built." }
  ];
  const plan = buildInterviewStructurePlan(history, 240, 900);
  assert.equal(plan.categoryCounts.technical, 2);
  assert.equal(plan.categoryCounts.project, 1);
  assert.equal(plan.categoryCounts.practical, 0);
  assert.equal(plan.categoryCounts.situational, 0);
  assert.equal(plan.nextCategory, "practical");
});

test("wrap-up takes priority in the final 90 seconds", () => {
  const plan = buildInterviewStructurePlan([], 820, 900);
  assert.equal(plan.phase, "wrap_up");
  assert.equal(plan.nextCategory, null);
  assert.match(buildInterviewStructureGuidance(plan), /wrap-up phase/);
});

test("ignores candidate answers and unknown question text", () => {
  const plan = buildInterviewStructurePlan([
    { role: "user", content: "I debugged an API outage." },
    { role: "assistant", content: "Tell me about a project you worked on." }
  ]);
  assert.equal(plan.categoryCounts.practical, 0);
  assert.equal(plan.categoryCounts.situational, 0);
  assert.equal(plan.categoryCounts.project, 1);
});

test("guidance describes the next category without scoring the candidate", () => {
  const plan = buildInterviewStructurePlan([]);
  const guidance = buildInterviewStructureGuidance(plan);
  assert.match(guidance, /Technical foundations/);
  assert.match(guidance, /candidate score/);
});

test("starts with technical foundations before moving to other categories", () => {
  const plan = buildInterviewStructurePlan([]);
  assert.equal(plan.phase, "opening");
  assert.equal(plan.nextCategory, "technical");
});

import { buildInterviewDifficultyPlan, buildInterviewDifficultyGuidance } from "../lib/interview-structure-policy.mjs";

test("uses the same foundation-to-applied-to-advanced progression by answered turns", () => {
  const history = [
    { role: "assistant", content: "What is an API?" },
    { role: "user", content: "An API lets systems communicate." },
    { role: "assistant", content: "Explain HTTP methods." },
    { role: "user", content: "GET reads data and POST creates data." },
    { role: "assistant", content: "How would you design pagination?" },
    { role: "user", content: "I would use limit and cursor." },
    { role: "assistant", content: "How would you test this endpoint?" },
    { role: "user", content: "I would add unit and integration tests." },
    { role: "assistant", content: "How would you handle high traffic?" },
    { role: "user", content: "I would add caching and monitor latency." }
  ];
  assert.equal(buildInterviewDifficultyPlan(history.slice(0, 2)).level, "foundation");
  assert.equal(buildInterviewDifficultyPlan(history.slice(0, 4)).level, "applied");
  assert.equal(buildInterviewDifficultyPlan(history).level, "advanced");
});

test("does not advance difficulty for unanswered questions", () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? "assistant" : "user",
    content: "A short message"
  }));
  history[11] = { role: "assistant", content: "One more question?" };
  assert.equal(buildInterviewDifficultyPlan(history).answeredTurns, 5);
  assert.equal(buildInterviewDifficultyPlan(history).level, "advanced");
  const withOneMoreUnanswered = [...history, { role: "assistant", content: "Another question?" }];
  assert.equal(buildInterviewDifficultyPlan(withOneMoreUnanswered).answeredTurns, 5);
  assert.equal(buildInterviewDifficultyPlan(history.slice(0, 10)).answeredTurns, 5);
});

test("difficulty guidance requires consistent standards and avoids personal-characteristic adjustments", () => {
  const guidance = buildInterviewDifficultyGuidance(buildInterviewDifficultyPlan([]));
  assert.match(guidance, /same progression for every candidate/);
  assert.match(guidance, /accent/);
  assert.match(guidance, /not a candidate score/);
});
