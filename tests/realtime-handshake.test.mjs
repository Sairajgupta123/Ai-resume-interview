import test from "node:test";
import assert from "node:assert/strict";
import { waitForRealtimeSession } from "../lib/realtime-handshake.mjs";

class FakeSocket extends EventTarget {
  emit(type, data) {
    this.dispatchEvent(data === undefined
      ? new Event(type)
      : new MessageEvent(type, { data }));
  }
}

test("waits for both open and session.created when session.created arrives first", async () => {
  const socket = new FakeSocket();
  const ready = waitForRealtimeSession(socket, 100);
  socket.emit("message", JSON.stringify({ type: "session.created" }));
  socket.emit("open");
  await assert.doesNotReject(ready);
});

test("waits for both open and session.created when open arrives first", async () => {
  const socket = new FakeSocket();
  const ready = waitForRealtimeSession(socket, 100);
  socket.emit("open");
  socket.emit("message", JSON.stringify({ type: "session.created" }));
  await assert.doesNotReject(ready);
});

test("rejects provider initialization errors", async () => {
  const socket = new FakeSocket();
  const ready = waitForRealtimeSession(socket, 100);
  socket.emit("message", JSON.stringify({ type: "error", error: { message: "provider rejected session" } }));
  await assert.rejects(ready, /provider rejected session/);
});

test("rejects sockets that close before the session is created", async () => {
  const socket = new FakeSocket();
  const ready = waitForRealtimeSession(socket, 100);
  socket.emit("close");
  await assert.rejects(ready, /closed during initialization/);
});

test("times out if the provider never completes the handshake", async () => {
  const socket = new FakeSocket();
  await assert.rejects(waitForRealtimeSession(socket, 10), /initialization timed out/);
});

test("rejects provider errors after the socket opens but before session creation", async () => {
  const socket = new FakeSocket();
  const ready = waitForRealtimeSession(socket, 100);
  socket.emit("open");
  socket.emit("message", JSON.stringify({ type: "error", error: { message: "session configuration rejected" } }));
  await assert.rejects(ready, /session configuration rejected/);
});

test("rejects a close after session.created but before the open event", async () => {
  const socket = new FakeSocket();
  const ready = waitForRealtimeSession(socket, 100);
  socket.emit("message", JSON.stringify({ type: "session.created" }));
  socket.emit("close");
  await assert.rejects(ready, /closed during initialization/);
});

import { getFinalRealtimeTranscript } from "../lib/realtime-handshake.mjs";

test("extracts the completed candidate transcription event", () => {
  assert.deepEqual(
    getFinalRealtimeTranscript({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "  I built a REST API.  "
    }),
    { role: "user", text: "I built a REST API." }
  );
});

test("extracts the completed Grok audio transcript event", () => {
  assert.deepEqual(
    getFinalRealtimeTranscript({
      type: "response.output_audio_transcript.done",
      transcript: "  Tell me about the project. "
    }),
    { role: "assistant", text: "Tell me about the project." }
  );
});

test("does not persist xAI cumulative interim transcription updates", () => {
  assert.equal(
    getFinalRealtimeTranscript({
      type: "conversation.item.input_audio_transcription.updated",
      transcript: "I built a REST API"
    }),
    null
  );
});

test("ignores empty and unrelated transcript events", () => {
  assert.equal(getFinalRealtimeTranscript({ type: "response.done" }), null);
  assert.equal(getFinalRealtimeTranscript({ type: "conversation.item.input_audio_transcription.completed", transcript: "  " }), null);
  assert.equal(getFinalRealtimeTranscript(null), null);
});
