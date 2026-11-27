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
