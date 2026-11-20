import test from "node:test";
import assert from "node:assert/strict";
import {
  areInterviewQuestionsNearDuplicates,
  normalizeInterviewPrompt,
  validateInterviewerTurn
} from "../lib/interviewer-turn-policy.mjs";

const validTurn = {
  message: "Thanks for joining. Can you describe a project where you used React?",
  done: false,
  focus: "React project experience"
};

test("normalizes prompts for duplicate comparison", () => {
  assert.equal(normalizeInterviewPrompt("  Tell me about React?  "), "tell me about react");
});

test("accepts a valid single-question interviewer turn", () => {
  assert.deepEqual(validateInterviewerTurn(validTurn, []), {
    ok: true,
    value: validTurn
  });
});

test("rejects turns containing multiple questions", () => {
  assert.equal(validateInterviewerTurn({
    ...validTurn,
    message: "What is React? How does it work?"
  }).reason, "one_question_required");
});

test("rejects turns without a question", () => {
  assert.equal(validateInterviewerTurn({
    ...validTurn,
    message: "Thanks for joining. Tell me about your project."
  }).reason, "one_question_required");
});

test("rejects an exact repeated interviewer prompt", () => {
  assert.equal(validateInterviewerTurn(validTurn, [
    "Thanks for joining. Can you describe a project where you used React?"
  ]).reason, "repeated_question");
});

test("rejects invalid completion flags and focus labels", () => {
  assert.equal(validateInterviewerTurn({ ...validTurn, done: "false" }).reason, "invalid_completion_flag");
  assert.equal(validateInterviewerTurn({ ...validTurn, focus: "" }).reason, "invalid_focus");
});

test("rejects oversized or empty interviewer messages", () => {
  assert.equal(validateInterviewerTurn({ ...validTurn, message: "x".repeat(12001) }).reason, "message_length");
  assert.equal(validateInterviewerTurn({ ...validTurn, message: "" }).reason, "message_length");
});

test("rejects malformed provider responses", () => {
  assert.equal(validateInterviewerTurn(null).reason, "invalid_turn");
  assert.equal(validateInterviewerTurn({ message: 123 }).reason, "invalid_message");
});

test("accepts a closing statement without a new question", () => {
  const closing = {
    message: "Thank you for your time. The interview is now complete.",
    done: true,
    focus: "Interview complete"
  };
  assert.equal(validateInterviewerTurn(closing).ok, true);
});

test("rejects a closing statement that asks another question", () => {
  const closing = {
    message: "Thank you for your time. Do you have any questions?",
    done: true,
    focus: "Interview complete"
  };
  assert.equal(validateInterviewerTurn(closing).reason, "closing_must_not_ask_question");
});

test("rejects near-duplicate questions with changed wording", () => {
  const previous = "Can you explain how an API authentication flow works?";
  const repeated = {
    ...validTurn,
    message: "Please explain how API authentication works?"
  };
  assert.equal(areInterviewQuestionsNearDuplicates(previous, repeated.message), true);
  assert.equal(validateInterviewerTurn(repeated, [previous]).reason, "repeated_question");
});

test("allows a different question about the same broad technical area", () => {
  const previous = "How would you design a REST API for high traffic caching?";
  const next = {
    ...validTurn,
    message: "How would you secure API authentication using short-lived tokens?"
  };
  assert.equal(areInterviewQuestionsNearDuplicates(previous, next.message), false);
  assert.equal(validateInterviewerTurn(next, [previous]).ok, true);
});

test("does not over-classify short questions as near duplicates", () => {
  assert.equal(areInterviewQuestionsNearDuplicates("What is Java?", "What is JavaScript?"), false);
});
