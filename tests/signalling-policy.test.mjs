import test from "node:test";
import assert from "node:assert/strict";
import { validateSignalPayload } from "../lib/signalling-policy.mjs";

test("accepts valid offer and answer descriptions from their assigned participants", () => {
  assert.deepEqual(validateSignalPayload("offer", JSON.stringify({ type: "offer", sdp: "v=0\\r\\n" }), "candidate"), { ok: true });
  assert.deepEqual(validateSignalPayload("answer", JSON.stringify({ type: "answer", sdp: "v=0\\r\\n" }), "employer"), { ok: true });
});

test("rejects session descriptions sent by the wrong participant", () => {
  const offer = JSON.stringify({ type: "offer", sdp: "v=0" });
  const answer = JSON.stringify({ type: "answer", sdp: "v=0" });
  assert.equal(validateSignalPayload("offer", offer, "employer").ok, false);
  assert.equal(validateSignalPayload("answer", answer, "candidate").ok, false);
});

test("rejects mismatched or malformed session descriptions", () => {
  for (const payload of ["{", "[]", JSON.stringify({ type: "answer", sdp: "v=0" }), JSON.stringify({ type: "offer", sdp: "" }), JSON.stringify({ type: "offer", sdp: "x".repeat(20_001) })]) {
    assert.equal(validateSignalPayload("offer", payload, "candidate").ok, false);
  }
});

test("accepts valid ICE candidates and end-of-candidates", () => {
  assert.deepEqual(validateSignalPayload("ice", JSON.stringify({ candidate: "candidate:1 1 UDP 1 127.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: 0 }), "candidate"), { ok: true });
  assert.deepEqual(validateSignalPayload("ice", JSON.stringify({ candidate: "" }), "employer"), { ok: true });
});

test("rejects malformed and oversized ICE candidate fields", () => {
  for (const payload of ["{}", JSON.stringify({ candidate: "x".repeat(4097) }), JSON.stringify({ candidate: "x", sdpMLineIndex: -1 }), JSON.stringify({ candidate: "x", sdpMid: "x".repeat(257) })]) {
    assert.equal(validateSignalPayload("ice", payload, "candidate").ok, false);
  }
});

test("hangup signal must match the authenticated sender", () => {
  assert.deepEqual(validateSignalPayload("hangup", "candidate-ended", "candidate"), { ok: true });
  assert.deepEqual(validateSignalPayload("hangup", "employer-ended", "employer"), { ok: true });
  assert.equal(validateSignalPayload("hangup", "candidate-ended", "employer").ok, false);
});

test("rejects unknown kinds and oversized payloads", () => {
  assert.equal(validateSignalPayload("offer", "x".repeat(24_001), "candidate").ok, false);
  assert.equal(validateSignalPayload("unexpected", "x", "candidate").ok, false);
});


test("a newer SDP description supersedes an earlier hangup signal", async () => {
  const { isSignalOlderThanDescription } = await import("../lib/signalling-policy.mjs");
  assert.equal(isSignalOlderThanDescription("2026-11-27T10:00:00.000Z", "b", "2026-11-27T10:00:01.000Z", "a"), true);
});

test("a hangup after the latest SDP description remains active", async () => {
  const { isSignalOlderThanDescription } = await import("../lib/signalling-policy.mjs");
  assert.equal(isSignalOlderThanDescription("2026-11-27T10:00:02.000Z", "b", "2026-11-27T10:00:01.000Z", "a"), false);
});

test("same-timestamp signal ordering uses stable IDs", async () => {
  const { isSignalOlderThanDescription } = await import("../lib/signalling-policy.mjs");
  assert.equal(isSignalOlderThanDescription("2026-11-27T10:00:00.000Z", "a", "2026-11-27T10:00:00.000Z", "b"), true);
  assert.equal(isSignalOlderThanDescription("2026-11-27T10:00:00.000Z", "c", "2026-11-27T10:00:00.000Z", "b"), false);
});
