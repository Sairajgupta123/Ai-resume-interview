import test from "node:test";
import assert from "node:assert/strict";
import { buildBoundedReportTranscript } from "../lib/report-transcript-policy.mjs";

test("keeps complete recent messages within the transcript budget", () => {
  const messages = [
    { role: "user", content: "old answer" },
    { role: "assistant", content: "old question" },
    { role: "user", content: "recent answer" },
    { role: "assistant", content: "recent question" }
  ];
  const result = buildBoundedReportTranscript(messages, 50);
  assert.deepEqual(result.messages, messages.slice(2));
  assert.equal(result.transcript, "user: recent answer\nassistant: recent question");
  assert.equal(result.omittedMessages, 2);
  assert.ok(result.transcript.length <= 50);
});

test("does not cut a candidate answer in the middle", () => {
  const messages = [
    { role: "user", content: "x".repeat(30) },
    { role: "assistant", content: "y".repeat(20) }
  ];
  const result = buildBoundedReportTranscript(messages, 35);
  assert.deepEqual(result.messages, [{ role: "assistant", content: "y".repeat(20) }]);
  assert.equal(result.omittedMessages, 1);
});

test("preserves original order and excludes malformed entries", () => {
  const result = buildBoundedReportTranscript([
    { role: "user", content: "first" },
    null,
    { role: "system", content: "not a transcript speaker" },
    { role: "assistant", content: "second" }
  ], 100);
  assert.deepEqual(result.messages.map(item => item.content), ["first", "second"]);
  assert.equal(result.omittedMessages, 0);
});

test("returns an empty bounded transcript for invalid limits", () => {
  assert.deepEqual(buildBoundedReportTranscript([], 0), {
    messages: [], transcript: "", omittedMessages: 0
  });
});
