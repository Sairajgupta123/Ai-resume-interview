import test from "node:test";
import assert from "node:assert/strict";
import { extractGrokAssistantText } from "../lib/grok-response-policy.mjs";

test("extracts a non-empty assistant response", () => {
  assert.equal(extractGrokAssistantText({
    choices: [{ finish_reason: "stop", message: { content: "{\"message\":\"Hello\"}" } }]
  }), "{\"message\":\"Hello\"}");
});

test("rejects provider output truncated by the completion token limit", () => {
  assert.throws(
    () => extractGrokAssistantText({ choices: [{ finish_reason: "length", message: { content: "{\"overallScore\":" } }] }),
    /incomplete response/
  );
});

test("rejects empty, malformed and refused provider responses", () => {
  assert.throws(() => extractGrokAssistantText(null), /unexpected provider response/);
  assert.throws(() => extractGrokAssistantText({ choices: [] }), /unexpected provider response/);
  assert.throws(() => extractGrokAssistantText({ choices: [{ message: { content: " " } }] }), /empty response/);
  assert.throws(() => extractGrokAssistantText({ choices: [{ message: { refusal: "Cannot comply", content: "" } }] }), /could not complete/);
});

test("does not accept non-text content as an interview response", () => {
  assert.throws(() => extractGrokAssistantText({ choices: [{ message: { content: [{ type: "text", text: "hello" }] } }] }), /empty response/);
});
